/**
 * LEER LOS BLOQUEOS que tapan un rango — el único lector, WS1-T2.
 *
 * ⚠️ SIN `import "server-only"`, Y NO ES UN OLVIDO. Este módulo lo importa
 * `src/lib/sabina/tools/agenda-huecos.ts`, cuya MITAD PURA (`evaluarHora`,
 * `buscarHuecos`) se prueba con `tsx --test` — y ahí no hay bundler de Next
 * que resuelva el paquete `server-only`, así que el import tumbaba tres
 * suites enteras con «Cannot find module 'server-only'». El precedente está
 * al lado: `agenda-comun.ts` también trae prisma sin ese guardia, por lo
 * mismo. Lo que sí queda como señal es el sufijo `.server` del nombre y el
 * `import { prisma }` de abajo, que rompería cualquier build de cliente que
 * lo arrastrara.
 *
 * Lo llaman los DIEZ consumidores de disponibilidad (la rejilla del panel, el
 * bot de WhatsApp, Sabina, «Buscar espacio», la página web de la clínica, las
 * solicitudes sin cuenta, las dos rutas del portal del paciente y los dos POST
 * públicos que escriben). Cada uno recibe las filas y decide con
 * `bloqueaEsteHueco` del core; ninguno arma su propio `where`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 «SOLAPAN», NO «EMPIEZAN DENTRO»
 *
 * Un puente que arranca el viernes y termina el lunes tiene que SALIR cuando
 * se pregunta por el sábado. Con un filtro de `startsAt` dentro del día no
 * saldría y la agenda del sábado se pintaría abierta. La condición es la del
 * core (`[inicio, fin)` que se cruzan) escrita como `where`.
 *
 * 🔴 `clinicId` SIEMPRE, Y CORTANDO ANTES SI FALTA
 *
 * En Prisma un `clinicId: undefined` BORRA el filtro y devuelve las filas de
 * TODAS las clínicas: le enseñaría a una clínica los bloqueos de otra, y —
 * peor — le taparía huecos suyos por las vacaciones de un doctor ajeno. Está
 * escrito así en src/lib/booking-requests/server.ts porque ya pasó.
 *
 * 🔴 LA TABLA PUEDE NO EXISTIR TODAVÍA, Y ESO NO PUEDE TUMBAR LA AGENDA
 *
 * El SQL de esta tarea lo aplica Rafael A MANO (regla (e) de CLAUDE.md), así
 * que entre que el código se integra y él lo pega hay una ventana en la que
 * `agenda_blocks` no existe. Si esa lectura lanzara, se caerían a la vez la
 * reserva pública, el bot y la agenda del panel de TODAS las clínicas. Se
 * trata como lo trata `booking-requests/server.ts`: tabla ausente → cero
 * bloqueos → el sistema se comporta exactamente como antes de esta tarea.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BLOQUEOS_MAX_FILAS,
  BloqueoError,
  esDiaCompleto,
  type AgendaBlockKind,
  type BloqueoDTO,
  type BloqueoLike,
} from "./core";
import type { BloqueoCtx } from "./core-ctx";

/** Un bloqueo vigente tal como lo consumen las calculadoras de huecos. */
export interface BloqueoVigente extends BloqueoLike {
  id: string;
  doctorId: string | null;
  startsAt: Date;
  endsAt: Date;
  kind: AgendaBlockKind;
  reason: string;
  holidayKey: string | null;
  deletedAt: null;
}

/**
 * La rendija de lectura, para que Sabina pueda pasar SU cliente (el de la
 * sesión) y las pruebas uno de mentira. Igual que `AgendaDb`: solo lectura.
 */
export interface BloqueosDb {
  agendaBlock: { findMany(args: any): Promise<any[]> };
}

/** ¿El error es «esa tabla/columna no existe»? Mismo criterio que booking-requests. */
export function esTablaAusente(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "P2021" || code === "42P01";
}

/**
 * LOS BLOQUEOS VIGENTES que solapan `[desde, hasta)`.
 *
 * `doctorIds`: si se pasa, solo vuelven los de esos doctores MÁS los de toda
 * la clínica (`doctorId: null`) — que alcanzan a todo el mundo y por eso no
 * se pueden filtrar fuera. Sin él, todos los de la clínica.
 *
 * Ordenados por `startsAt`, que es lo que hace que `bloqueaEsteHueco` devuelva
 * el que empezó antes cuando varios tapan el mismo hueco.
 */
export async function leerBloqueosDelRango(
  clinicId: string,
  desde: Date,
  hasta: Date,
  opciones: { doctorIds?: readonly string[]; db?: BloqueosDb } = {},
): Promise<BloqueoVigente[]> {
  // Corta ANTES de consultar: un clinicId vacío no filtra, devuelve el mundo.
  if (!clinicId || typeof clinicId !== "string") return [];
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) return [];
  if (hasta.getTime() <= desde.getTime()) return [];

  const db = opciones.db ?? (prisma as unknown as BloqueosDb);
  // El cliente puede no tener el modelo: Sabina pasa su rendija de lectura
  // (`AgendaDb`), y en pruebas es un doble que solo declara lo que esa prueba
  // necesita. Sin esto, añadir bloqueos a `leerOcupacion` habría roto de golpe
  // todas las pruebas de agenda de Sabina con un "findMany of undefined".
  if (typeof db?.agendaBlock?.findMany !== "function") return [];

  const where: Record<string, unknown> = {
    clinicId,
    deletedAt: null,
    startsAt: { lt: hasta },
    endsAt: { gt: desde },
  };
  if (opciones.doctorIds) {
    // El `null` va SIEMPRE en el OR: un cierre de toda la clínica alcanza a
    // cualquier doctor, así que filtrarlo fuera pintaría abierto el 25 de
    // diciembre. Con la lista vacía quedan solo los de toda la clínica, que
    // es exactamente lo correcto.
    where.OR = [{ doctorId: null }, { doctorId: { in: [...opciones.doctorIds] } }];
  }

  try {
    const filas = await db.agendaBlock.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: BLOQUEOS_MAX_FILAS,
      select: {
        id: true,
        doctorId: true,
        kind: true,
        reason: true,
        startsAt: true,
        endsAt: true,
        holidayKey: true,
      },
    });
    return filas.map((b: any) => ({
      id: b.id as string,
      doctorId: (b.doctorId ?? null) as string | null,
      kind: b.kind as AgendaBlockKind,
      reason: b.reason as string,
      startsAt: new Date(b.startsAt),
      endsAt: new Date(b.endsAt),
      holidayKey: (b.holidayKey ?? null) as string | null,
      deletedAt: null as null,
    }));
  } catch (err) {
    if (esTablaAusente(err)) {
      // Una vez por arranque basta para enterarse; en cada petición sería
      // ruido en los logs de producción.
      avisaTablaAusenteUnaVez();
      return [];
    }
    throw err;
  }
}

/**
 * Atajo para el caso más común: los bloqueos de UN día de calendario, en la
 * zona de la clínica. Evita que cada consumidor arme su propio rango de día.
 */
export async function leerBloqueosDelDia(
  clinicId: string,
  inicioDiaUtc: Date,
  finDiaUtc: Date,
  opciones: { doctorIds?: readonly string[]; db?: BloqueosDb } = {},
): Promise<BloqueoVigente[]> {
  return leerBloqueosDelRango(clinicId, inicioDiaUtc, finDiaUtc, opciones);
}

let yaAvisado = false;
function avisaTablaAusenteUnaVez(): void {
  if (yaAvisado) return;
  yaAvisado = true;
  console.warn(
    "[agenda-bloqueos] la tabla agenda_blocks no existe todavía: " +
      "aplica sql/agenda-bloqueos.sql. Hasta entonces no hay bloqueos y la " +
      "disponibilidad se calcula como antes.",
  );
}


// ═══════════════════════════════════════════════════════════════════════
// LA LISTA Y SU DTO
//
// Viven aquí, con el lector, y no en service.ts: el GET de la agenda
// (`/api/appointments`) adjunta los bloqueos al payload para que ws1-t3 pinte
// la franja, y ese endpoint se prueba con `tsx --test` y mocks de módulo.
// service.ts es la mitad que ESCRIBE (crear, editar, retirar, festivos) y no
// hace falta para leer.
// ═══════════════════════════════════════════════════════════════════════

export interface FilaBloqueo {
  id: string;
  doctorId: string | null;
  kind: AgendaBlockKind;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  holidayKey: string | null;
  createdByName: string;
  createdAt: Date;
  doctor?: { firstName: string; lastName: string } | null;
}

export const SELECT_BLOQUEO = {
  id: true,
  doctorId: true,
  kind: true,
  reason: true,
  startsAt: true,
  endsAt: true,
  holidayKey: true,
  createdByName: true,
  createdAt: true,
  doctor: { select: { firstName: true, lastName: true } },
} as const;

/**
 * ¿Quien pide puede RETIRAR este bloqueo? Es lo que viaja en
 * `puedoRetirarlo`, y lo decide el SERVIDOR: la pantalla solo enseña o
 * esconde el botón. Si lo razonara ella, el día que cambie la regla habría
 * dos versiones de la verdad y una enseñaría un botón que devuelve 403.
 */
export function puedeRetirar(
  ctx: { role: Role; userId: string },
  bloqueo: { doctorId: string | null },
): boolean {
  if (ctx.role === "ADMIN" || ctx.role === "SUPER_ADMIN" || ctx.role === "RECEPTIONIST") return true;
  // «El doctor puede quitar su bloqueo» (Rafael). El SUYO: no el de la
  // clínica (doctorId null) ni el de un compañero.
  if (ctx.role === "DOCTOR") return bloqueo.doctorId !== null && bloqueo.doctorId === ctx.userId;
  return false;
}

export function aDTO(ctx: BloqueoCtx, b: FilaBloqueo): BloqueoDTO {
  return {
    id: b.id,
    doctorId: b.doctorId,
    doctorNombre: b.doctor
      ? `${b.doctor.firstName ?? ""} ${b.doctor.lastName ?? ""}`.trim() || null
      : null,
    kind: b.kind,
    reason: b.reason,
    inicio: b.startsAt.toISOString(),
    fin: b.endsAt.toISOString(),
    diaCompleto: esDiaCompleto(b.startsAt, b.endsAt, ctx.timezone),
    holidayKey: b.holidayKey,
    creadoPor: b.createdByName,
    creadoEl: b.createdAt.toISOString(),
    puedoRetirarlo: puedeRetirar(ctx, b),
  };
}

/**
 * LA LISTA de bloqueos que solapan `[desde, hasta)`.
 *
 * 🔴 EL DOCTOR RECIBE SOLO LOS SUYOS Y LOS DE TODA LA CLÍNICA. No es
 * privacidad por privacidad: el bloqueo de una compañera lleva escrito su
 * motivo («operación de rodilla»), y eso no es de la agenda de nadie más. Lo
 * que sí ve siempre es lo que le afecta.
 */
export async function listarBloqueos(
  ctx: BloqueoCtx,
  query: { desde?: unknown; hasta?: unknown },
): Promise<BloqueoDTO[]> {
  // Corta ANTES de consultar: en Prisma un clinicId vacío no filtra nada.
  if (!ctx?.clinicId || typeof ctx.clinicId !== "string") {
    throw new BloqueoError("Tu sesión no trae clínica. Vuelve a entrar.", 401, "SIN_SESION");
  }

  const desde = new Date(String(query?.desde ?? ""));
  const hasta = new Date(String(query?.hasta ?? ""));
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    throw new BloqueoError(
      "Manda el rango («desde» y «hasta») en formato ISO.",
      400,
      "RANGO_REQUERIDO",
    );
  }
  if (hasta.getTime() <= desde.getTime()) {
    throw new BloqueoError("El «hasta» tiene que ser posterior al «desde».", 400, "RANGO_INVERTIDO");
  }

  const where: Record<string, unknown> = {
    clinicId: ctx.clinicId,
    deletedAt: null,
    startsAt: { lt: hasta },
    endsAt: { gt: desde },
  };
  if (ctx.role === "DOCTOR") {
    where.OR = [{ doctorId: null }, { doctorId: ctx.userId }];
  }

  try {
    const filas = await prisma.agendaBlock.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: BLOQUEOS_MAX_FILAS,
      select: SELECT_BLOQUEO,
    });
    return filas.map((b) => aDTO(ctx, b as FilaBloqueo));
  } catch (err) {
    // Antes de que Rafael pegue el SQL, la pantalla enseña «no hay bloqueos»
    // en vez de un 500. Ver el porqué completo en la cabecera.
    if (esTablaAusente(err)) return [];
    throw err;
  }
}
