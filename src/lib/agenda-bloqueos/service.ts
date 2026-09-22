import "server-only";

/**
 * LOS BLOQUEOS DE AGENDA contra la base — WS1-T2.
 *
 * SERVIDOR: aquí sí entra prisma. Lo puro (el solape, el alcance por doctor,
 * los parsers) vive en core.ts; el lector que usan los consumidores de
 * disponibilidad, en consulta.server.ts.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 EL ALCANCE POR ROL VIVE AQUÍ, NO EN LA PANTALLA
 *
 * Esto es lo que sustituye a un flujo de aprobación, así que tiene que estar
 * en el SERVIDOR: una regla escondida en un `if` de React la salta cualquiera
 * con la consola abierta.
 *
 *   ADMIN / SUPER_ADMIN → crea con `doctorId = null` (toda la clínica) o con
 *                         cualquier doctor de su clínica. Retira cualquiera.
 *   DOCTOR              → SOLO con su propio `user.id`. Si manda `null` o el
 *                         id de otro → 403. Retira LOS SUYOS, no los de la
 *                         clínica ni los de un compañero.
 *   RECEPTIONIST        → nada por defecto; le llega si el SUPER_ADMIN le
 *                         enciende `agenda.bloqueos` desde Equipo, y entonces
 *                         cuenta como administrativo.
 *
 * El modelo de edu lo resume en una frase (`agenda-bloqueos.ts:231`): «cerrar
 * la escuela completa no es una decisión de un coordinador de sede». Aquí:
 * cerrar la clínica entera no es decisión de un doctor.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴🔴 EL CHOQUE CON CITAS YA AGENDADAS — donde dental se aparta de edu
 *
 * Edu deja bloquear encima de lo agendado. Aquí NO: si dentro del rango hay
 * una cita VIVA, el bloqueo no se crea y sale un 409 con la lista, para que
 * primero se muevan esas citas. La razón es que un bloqueo que se pone encima
 * de una cita no cancela nada —ni debe—, así que dejaría una cita agendada
 * dentro de un hueco que el sistema anuncia como cerrado: el paciente llega y
 * no hay nadie.
 *
 * «Viva» = el MISMO criterio con el que la rejilla cuenta minutos ocupados
 * (`citaViva` de src/lib/agenda-nueva/estados.ts): todo menos CANCELLED y
 * NO_SHOW. Una cancelada o un plantón no estorban.
 * ═══════════════════════════════════════════════════════════════════════
 */

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BloqueoCtx } from "./core-ctx";
import { getTzParts } from "@/lib/agenda/time-utils";
import { ESTADOS_MUERTOS } from "@/lib/agenda-nueva/estados";
import { logAudit } from "@/lib/audit";
import {
  BloqueoError,
  CHOQUE_MAX,
  BLOQUEOS_MAX_FILAS,
  bloqueoAlcanzaDoctor,
  esDiaCompleto,
  parseKind,
  parseMotivo,
  parseRangoTecleado,
  rangoDeDiaCompleto,
  type AgendaBlockKind,
  type BloqueoDTO,
  type CitaEnChoque,
  type RangoTecleado,
  type RespuestaChoque,
} from "./core";
import {
  SELECT_BLOQUEO,
  aDTO,
  esTablaAusente,
  listarBloqueos,
  puedeRetirar,
  type FilaBloqueo,
} from "./consulta.server";

// Re-exportados para que quien ya los importaba de aquí siga encontrándolos:
// viven en consulta.server.ts (sin `server-only`) porque el GET de la agenda
// los necesita y ese endpoint se prueba con `tsx --test` y mocks de módulo.
export { listarBloqueos, puedeRetirar };
import { festivosDeMexico, type FestivoMX } from "./festivos-mx";

/**
 * Quién pide. Vive en core-ctx.ts —un módulo sin prisma— para que las rutas
 * puedan tipar su contexto sin arrastrar este archivo entero. Sale SIEMPRE de
 * la sesión: el `clinicId` del cliente es el `clinicId` de quien quiera
 * escribirlo.
 */
export type { BloqueoCtx } from "./core-ctx";

/**
 * Lo que devuelven CREAR y EDITAR.
 *
 * 🔴 UN SOLO TIPO CON DOS CAMPOS ANULABLES, y no la unión discriminada
 * `{ok:true,bloqueo} | {ok:false,choque}` que pedía el cuerpo. El repo compila
 * con `"strict": false` en tsconfig, y ahí TypeScript **no estrecha** una
 * unión por su discriminante: tras un `if (!res.ok)`, leer `res.choque` da
 * TS2339. Medido en esta misma tarea. Con un solo tipo, las rutas lo leen sin
 * castings y el compilador sigue exigiendo que se contemplen los dos casos.
 */
export interface ResultadoEscritura {
  ok: boolean;
  bloqueo: BloqueoDTO | null;
  choque: RespuestaChoque | null;
}

/** Los estados que NO estorban a un bloqueo: los mismos que no ocupan sillón. */
const ESTADOS_QUE_NO_ESTORBAN: readonly string[] = ESTADOS_MUERTOS;

/** ¿Quien pide manda sobre toda la clínica? */
function esAdministrativo(ctx: BloqueoCtx): boolean {
  return ctx.role === "ADMIN" || ctx.role === "SUPER_ADMIN" || ctx.role === "RECEPTIONIST";
}

function exigeClinica(ctx: BloqueoCtx): string {
  // Corta ANTES de consultar: en Prisma un clinicId vacío no filtra nada.
  if (!ctx?.clinicId || typeof ctx.clinicId !== "string") {
    throw new BloqueoError("Tu sesión no trae clínica. Vuelve a entrar.", 401, "SIN_SESION");
  }
  return ctx.clinicId;
}

function dosDig(n: number): string {
  return String(n).padStart(2, "0");
}

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL ALCANCE QUE PUEDE PEDIR QUIEN PIDE
// ═══════════════════════════════════════════════════════════════════════

/**
 * El `doctorId` con el que se va a guardar, validado contra el rol.
 *
 * `raw` ausente o `null` significa «toda la clínica». Un DOCTOR no puede
 * pedir eso ni el id de un compañero: en los dos casos sale 403, y el mensaje
 * dice qué sí puede hacer, porque un 403 sin salida es una llamada a soporte.
 */
async function resolverAlcance(ctx: BloqueoCtx, raw: unknown): Promise<string | null> {
  const clinicId = exigeClinica(ctx);
  const pedido = typeof raw === "string" && raw.trim() ? raw.trim() : null;

  if (ctx.role === "DOCTOR") {
    if (pedido === null) {
      throw new BloqueoError(
        "Cerrar la agenda de toda la clínica no es una decisión de un doctor. Puedes cerrar la tuya; para cerrar la clínica, pídeselo a la administración.",
        403,
        "ALCANCE_NO_PERMITIDO",
      );
    }
    if (pedido !== ctx.userId) {
      throw new BloqueoError(
        "Solo puedes bloquear tu propia agenda.",
        403,
        "ALCANCE_NO_PERMITIDO",
      );
    }
    return ctx.userId;
  }

  if (!esAdministrativo(ctx)) {
    throw new BloqueoError("No tienes permiso para cerrar huecos de la agenda.", 403, "SIN_PERMISO");
  }

  if (pedido === null) return null;

  // El doctor pedido tiene que ser de ESTA clínica. Sin esta comprobación, un
  // administrador podría colgar un bloqueo del id de un doctor de otra
  // clínica: la fila quedaría en su tenant pero sin alcanzar a nadie de su
  // agenda, y nadie entendería por qué el bloqueo «no hace nada».
  const doctor = await prisma.user.findFirst({
    where: { id: pedido, clinicId },
    select: { id: true },
  });
  if (!doctor) {
    throw new BloqueoError("Ese doctor no existe o no es de tu clínica.", 404, "DOCTOR_NO_ENCONTRADO");
  }
  return doctor.id;
}


// ═══════════════════════════════════════════════════════════════════════
// 2 · EL CHOQUE CON CITAS YA AGENDADAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * LAS CITAS VIVAS que caen dentro del rango y que el bloqueo taparía.
 *
 * El choque RESPETA EL ALCANCE: un bloqueo de un doctor solo choca con las
 * citas de ESE doctor; uno de toda la clínica, con las de todos. Sin eso, un
 * doctor no podría irse de vacaciones porque su compañera tiene la agenda
 * llena — y la lista de «citas que mover» le saldría llena de citas ajenas
 * que él no puede tocar.
 *
 * `excluirBloqueoId` no aplica aquí (esto mira CITAS, no bloqueos); lo que sí
 * se hace es volver a llamarla al EDITAR, porque mover el rango puede meter
 * dentro citas que antes quedaban fuera.
 */
export async function citasEnElRango(
  ctx: BloqueoCtx,
  args: { doctorId: string | null; startsAt: Date; endsAt: Date },
): Promise<RespuestaChoque | null> {
  const clinicId = exigeClinica(ctx);

  const where = {
    clinicId,
    // Solo las que OCUPAN agenda. Mismo criterio que `citaViva`: una
    // cancelada o un plantón liberaron su hueco y no estorban.
    status: { notIn: [...ESTADOS_QUE_NO_ESTORBAN] as any },
    startsAt: { lt: args.endsAt },
    endsAt: { gt: args.startsAt },
    // Alcance: `null` = todos los doctores de la clínica.
    ...(args.doctorId ? { doctorId: args.doctorId } : {}),
  };

  const [total, filas] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: CHOQUE_MAX,
      select: {
        id: true,
        startsAt: true,
        doctorId: true,
        patient: { select: { firstName: true, lastName: true } },
        doctor: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  if (total === 0) return null;

  const citas: CitaEnChoque[] = filas.map((a) => {
    const p = getTzParts(a.startsAt, ctx.timezone);
    return {
      id: a.id,
      fecha: `${p.year}-${dosDig(p.month)}-${dosDig(p.day)}`,
      hora: `${dosDig(p.hour)}:${dosDig(p.minute)}`,
      pacienteNombre: `${a.patient?.firstName ?? ""} ${a.patient?.lastName ?? ""}`.trim() || "Paciente",
      doctorNombre: `${a.doctor?.firstName ?? ""} ${a.doctor?.lastName ?? ""}`.trim() || "Sin responsable",
      doctorId: a.doctorId,
    };
  });

  return { error: "CITAS_EN_EL_RANGO", citas, total };
}

/**
 * EL CHEQUEO EN SECO: el mismo choque, sin crear nada.
 *
 * Es lo que hace que el aviso salga MIENTRAS se eligen las fechas y no al
 * final, cuando ya se dio a guardar. Devuelve `null` cuando no hay choque, y
 * ese `null` es tan informativo como la lista: es el «adelante» de la
 * pantalla.
 */
export async function revisarChoque(
  ctx: BloqueoCtx,
  body: RangoTecleado & { doctorId?: unknown },
): Promise<RespuestaChoque | null> {
  const doctorId = await resolverAlcance(ctx, body?.doctorId);
  const { startsAt, endsAt } = parseRangoTecleado(body, ctx.timezone);
  return citasEnElRango(ctx, { doctorId, startsAt, endsAt });
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · CREAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * CREA un bloqueo. `RespuestaChoque` en vez de `{ id }` cuando hay citas
 * dentro: la ruta lo traduce a 409.
 */
export async function crearBloqueo(
  ctx: BloqueoCtx,
  body: RangoTecleado & {
    doctorId?: unknown;
    kind?: unknown;
    reason?: unknown;
    holidayKey?: unknown;
  },
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<ResultadoEscritura> {
  const clinicId = exigeClinica(ctx);

  const doctorId = await resolverAlcance(ctx, body?.doctorId);
  const kind = parseKind(body?.kind);
  const reason = parseMotivo(body?.reason);
  const { startsAt, endsAt } = parseRangoTecleado(body, ctx.timezone);
  const holidayKey =
    typeof body?.holidayKey === "string" && body.holidayKey.trim()
      ? body.holidayKey.trim().slice(0, 40)
      : null;

  const choque = await citasEnElRango(ctx, { doctorId, startsAt, endsAt });
  if (choque) return { ok: false, bloqueo: null, choque };

  const creado = await prisma.agendaBlock.create({
    data: {
      clinicId,
      doctorId,
      kind,
      reason,
      startsAt,
      endsAt,
      holidayKey,
      createdById: ctx.userId,
      // Se CONGELA: el bloqueo sigue diciendo quién fue aunque esa persona se
      // vaya de la clínica.
      createdByName: (ctx.displayName || "—").slice(0, 160),
    },
    select: SELECT_BLOQUEO,
  });

  await logAudit({
    clinicId,
    userId: ctx.userId,
    entityType: "agenda-block",
    entityId: creado.id,
    action: "create",
    changes: {
      reason: { before: null, after: reason },
      kind: { before: null, after: kind },
      doctorId: { before: null, after: doctorId },
      startsAt: { before: null, after: startsAt.toISOString() },
      endsAt: { before: null, after: endsAt.toISOString() },
    },
    ...meta,
  });

  return { ok: true, bloqueo: aDTO(ctx, creado as FilaBloqueo), choque: null };
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · EDITAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * EDITA el motivo y/o el rango.
 *
 * 🔴 REVALIDA EL CHOQUE. Mover el rango puede meter dentro citas que antes
 * quedaban fuera: un bloqueo que se estira del 24 al 26 tiene que chocar con
 * la limpieza del 25 igual que si se creara de cero. Sin esto, el 409 de la
 * creación sería un candado con la puerta de atrás abierta.
 *
 * El ALCANCE (`doctorId`) NO se edita: cambiarlo convierte el bloqueo en otro
 * distinto —uno de toda la clínica donde había uno de un doctor— y el rastro
 * de quién lo creó dejaría de explicar lo que hay. Para eso se retira y se
 * pone uno nuevo, que además vuelve a pasar por el choque.
 */
export async function editarBloqueo(
  ctx: BloqueoCtx,
  bloqueoId: string,
  body: RangoTecleado & { kind?: unknown; reason?: unknown },
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<ResultadoEscritura> {
  const clinicId = exigeClinica(ctx);
  const id = typeof bloqueoId === "string" ? bloqueoId.trim() : "";
  if (!id) throw new BloqueoError("Falta el bloqueo.", 400, "FALTA_ID");

  const actual = await prisma.agendaBlock.findFirst({
    where: { id, clinicId },
    select: { ...SELECT_BLOQUEO, deletedAt: true },
  });
  if (!actual) {
    throw new BloqueoError("Ese bloqueo no existe o no es de tu clínica.", 404, "NO_ENCONTRADO");
  }
  if (actual.deletedAt) {
    throw new BloqueoError("Ese bloqueo ya estaba retirado.", 409, "YA_RETIRADO");
  }
  // Editar exige lo mismo que retirar: es el mismo bloqueo y la misma
  // decisión. Un doctor edita el suyo y ninguno más.
  if (!puedeRetirar(ctx, actual)) {
    throw new BloqueoError(
      actual.doctorId === null
        ? "Ese bloqueo es de toda la clínica: solo la administración puede cambiarlo."
        : "Ese bloqueo no es tuyo.",
      403,
      "NO_ES_TUYO",
    );
  }

  const reason = body?.reason === undefined ? actual.reason : parseMotivo(body.reason);
  const kind = body?.kind === undefined ? (actual.kind as AgendaBlockKind) : parseKind(body.kind);

  // El rango se toca solo si vino alguno de sus campos; si no, se conserva.
  const tocaRango =
    body?.desdeDia !== undefined ||
    body?.hastaDia !== undefined ||
    body?.desdeHora !== undefined ||
    body?.hastaHora !== undefined;
  const { startsAt, endsAt } = tocaRango
    ? parseRangoTecleado(body, ctx.timezone)
    : { startsAt: actual.startsAt, endsAt: actual.endsAt };

  if (tocaRango) {
    const choque = await citasEnElRango(ctx, { doctorId: actual.doctorId, startsAt, endsAt });
    if (choque) return { ok: false, bloqueo: null, choque };
  }

  const guardado = await prisma.agendaBlock.update({
    where: { id: actual.id },
    data: { reason, kind, startsAt, endsAt },
    select: SELECT_BLOQUEO,
  });

  await logAudit({
    clinicId,
    userId: ctx.userId,
    entityType: "agenda-block",
    entityId: actual.id,
    action: "update",
    changes: {
      reason: { before: actual.reason, after: reason },
      kind: { before: actual.kind, after: kind },
      startsAt: { before: actual.startsAt.toISOString(), after: startsAt.toISOString() },
      endsAt: { before: actual.endsAt.toISOString(), after: endsAt.toISOString() },
    },
    ...meta,
  });

  return { ok: true, bloqueo: aDTO(ctx, guardado as FilaBloqueo), choque: null };
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · RETIRAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * RETIRA un bloqueo. Baja LÓGICA: la fila se queda con su `deletedAt`.
 *
 * 🔴 NO SE BORRA, y no es simetría por simetría: un bloqueo que existió
 * explica por qué esa tarde de hace tres meses no hubo nadie en la clínica.
 * Borrarlo dejaría un hueco vacío en la agenda de entonces sin explicación
 * posible, y es justo la pregunta que alguien hace al revisar el mes.
 */
export async function retirarBloqueo(
  ctx: BloqueoCtx,
  bloqueoId: string,
  meta: { ipAddress?: string; userAgent?: string } = {},
  ahora: Date = new Date(),
): Promise<{ id: string }> {
  const clinicId = exigeClinica(ctx);
  const id = typeof bloqueoId === "string" ? bloqueoId.trim() : "";
  if (!id) throw new BloqueoError("Falta el bloqueo.", 400, "FALTA_ID");

  const b = await prisma.agendaBlock.findFirst({
    where: { id, clinicId },
    select: { id: true, doctorId: true, reason: true, deletedAt: true, holidayKey: true },
  });
  if (!b) throw new BloqueoError("Ese bloqueo no existe o no es de tu clínica.", 404, "NO_ENCONTRADO");
  if (!puedeRetirar(ctx, b)) {
    throw new BloqueoError(
      b.doctorId === null
        ? "Ese bloqueo es de toda la clínica: solo la administración puede retirarlo."
        : "Ese bloqueo no es tuyo.",
      403,
      "NO_ES_TUYO",
    );
  }

  // `updateMany` con `deletedAt: null` en el where: si dos personas le dan al
  // mismo botón a la vez, la segunda recibe 409 en vez de pisar la fecha de
  // la primera y perder quién lo retiró de verdad.
  // 🔴 AL RETIRAR SE LIBERA LA `holidayKey`, y esto no es cosmética.
  //
  // `@@unique([clinicId, holidayKey])` existe para que el mismo festivo no se
  // aplique dos veces. Pero la fila retirada NO desaparece (baja lógica), así
  // que si conservara su clave, retirar la Navidad y volver a ponerla daría
  // P2002 para siempre: la pantalla diría «ya estaba» sobre un festivo que la
  // clínica acaba de quitar, y no habría forma de volver a ponerlo.
  //
  // La alternativa era un índice único PARCIAL (`WHERE deleted_at IS NULL`),
  // que Prisma 5 no sabe declarar: el schema y la base quedarían distintos, y
  // con 11 migraciones del repo sin registrar contra producción esa diferencia
  // es justo la que nadie quiere heredar. Lo que se pierde es el enlace
  // legible por máquina del bloqueo retirado con su festivo; el `reason`
  // ("Navidad") y el registro de auditoría siguen diciéndolo.
  const res = await prisma.agendaBlock.updateMany({
    where: { id: b.id, clinicId, deletedAt: null },
    data: { deletedAt: ahora, deletedById: ctx.userId, holidayKey: null },
  });
  if (res.count === 0) {
    throw new BloqueoError("Ese bloqueo ya estaba retirado.", 409, "YA_RETIRADO");
  }

  await logAudit({
    clinicId,
    userId: ctx.userId,
    entityType: "agenda-block",
    entityId: b.id,
    action: "soft_delete",
    changes: {
      reason: { before: b.reason, after: b.reason },
      // Se anota la clave que se libera: es lo único que queda diciendo qué
      // festivo era, una vez que la columna se pone en null.
      holidayKey: { before: b.holidayKey, after: null },
      deletedAt: { before: null, after: ahora.toISOString() },
    },
    ...meta,
  });

  return { id: b.id };
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · LOS FESTIVOS
// ═══════════════════════════════════════════════════════════════════════

export interface FestivoConEstado extends FestivoMX {
  /** Ya hay un bloqueo vigente con esta `holidayKey`. */
  aplicado: boolean;
  /** El id del bloqueo que lo aplica, para poder retirarlo desde la misma lista. */
  bloqueoId: string | null;
}

/** EL CATÁLOGO DEL AÑO más cuáles ya están puestos (por `holidayKey`). */
export async function festivosDelAnio(
  ctx: BloqueoCtx,
  anio: number,
): Promise<FestivoConEstado[]> {
  const clinicId = exigeClinica(ctx);
  const catalogo = festivosDeMexico(anio);

  let puestos: { id: string; holidayKey: string | null }[] = [];
  try {
    puestos = await prisma.agendaBlock.findMany({
      where: {
        clinicId,
        deletedAt: null,
        holidayKey: { in: catalogo.map((f) => f.key) },
      },
      select: { id: true, holidayKey: true },
    });
  } catch (err) {
    if (!esTablaAusente(err)) throw err;
  }

  const porKey = new Map(puestos.map((p) => [p.holidayKey ?? "", p.id]));
  return catalogo.map((f) => ({
    ...f,
    aplicado: porKey.has(f.key),
    bloqueoId: porKey.get(f.key) ?? null,
  }));
}

export interface ResultadoAplicarFestivos {
  creados: BloqueoDTO[];
  /** Los que NO se pudieron poner porque hay citas dentro, con su lista. */
  conChoque: Array<{ key: string; nombre: string; fecha: string; choque: RespuestaChoque }>;
  /** Los que ya estaban puestos: ni se tocan ni se duplican. */
  yaEstaban: string[];
}

/**
 * APLICA de golpe los festivos marcados.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 NO FALLA EN BLOQUE, Y ESA ES TODA LA FUNCIÓN
 *
 * Aplicar diciembre entero no puede caerse porque el 24 haya una limpieza
 * agendada. Cada festivo se intenta por separado: los que entran, entran; los
 * que chocan vuelven en `conChoque` con SU lista de citas, para que la
 * pantalla diga «se pusieron 4 de 5; el 24 tiene 2 citas». Un «no se pudo»
 * global obligaría a adivinar cuál era el que estorbaba.
 *
 * ⚠️ Es un bucle de inserciones, no un `createMany`: cada una necesita su
 * propio chequeo de choque contra las citas de ESE día. Va en serie a
 * propósito — son como mucho 13 festivos y la regla de la casa es menos de 7
 * consultas por `Promise.all`; en paralelo serían 13 × 3 contra el pooler.
 * ═══════════════════════════════════════════════════════════════════════
 */
export async function aplicarFestivos(
  ctx: BloqueoCtx,
  args: { anio: number; keys: string[]; doctorId?: unknown },
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<ResultadoAplicarFestivos> {
  exigeClinica(ctx);

  // Un festivo es de TODA la clínica salvo que se diga otra cosa; el alcance
  // pasa por la misma puerta que el resto, así que un DOCTOR solo puede
  // aplicárselos a sí mismo.
  const doctorId = await resolverAlcance(ctx, args?.doctorId);

  const catalogo = await festivosDelAnio(ctx, args.anio);
  const pedidos = new Set(Array.isArray(args?.keys) ? args.keys : []);
  const aPoner = catalogo.filter((f) => pedidos.has(f.key));
  if (aPoner.length === 0) {
    throw new BloqueoError(
      "No marcaste ningún festivo de ese año.",
      400,
      "SIN_FESTIVOS",
    );
  }

  const out: ResultadoAplicarFestivos = { creados: [], conChoque: [], yaEstaban: [] };

  for (const f of aPoner) {
    if (f.aplicado) {
      out.yaEstaban.push(f.key);
      continue;
    }
    const { startsAt, endsAt } = rangoDeDiaCompleto(f.fecha, ctx.timezone);
    const choque = await citasEnElRango(ctx, { doctorId, startsAt, endsAt });
    if (choque) {
      out.conChoque.push({ key: f.key, nombre: f.nombre, fecha: f.fecha, choque });
      continue;
    }

    try {
      const creado = await prisma.agendaBlock.create({
        data: {
          clinicId: ctx.clinicId,
          doctorId,
          kind: "FESTIVO" as AgendaBlockKind,
          reason: f.nombre.slice(0, 200),
          startsAt,
          endsAt,
          holidayKey: f.key,
          createdById: ctx.userId,
          createdByName: (ctx.displayName || "—").slice(0, 160),
        },
        select: SELECT_BLOQUEO,
      });
      out.creados.push(aDTO(ctx, creado as FilaBloqueo));

      await logAudit({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        entityType: "agenda-block",
        entityId: creado.id,
        action: "create",
        changes: {
          holidayKey: { before: null, after: f.key },
          reason: { before: null, after: f.nombre },
          startsAt: { before: null, after: startsAt.toISOString() },
          endsAt: { before: null, after: endsAt.toISOString() },
        },
        ...meta,
      });
    } catch (err) {
      // El `@@unique([clinicId, holidayKey])` es la última palabra contra dos
      // pestañas aplicando el mismo diciembre a la vez: el segundo choca y se
      // cuenta como «ya estaba», que es la verdad.
      if ((err as { code?: string })?.code === "P2002") {
        out.yaEstaban.push(f.key);
        continue;
      }
      throw err;
    }
  }

  return out;
}
