/**
 * LEER EL HORARIO PROPIO DE LOS DOCTORES — el único lector. WS1-T2 · horario.
 *
 * ⚠️ SIN `import "server-only"`, Y NO ES UN OLVIDO. Por lo mismo que
 * `agenda-bloqueos/consulta.server.ts`: lo importan módulos cuya mitad pura se
 * prueba con `tsx --test` (Sabina, las rutas montadas con mocks), y ahí no hay
 * bundler de Next que resuelva ese paquete. La señal de «solo servidor» es el
 * sufijo `.server` y el `import { prisma }` de abajo.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 `clinicId` SIEMPRE, Y CORTANDO ANTES SI FALTA
 *
 * En Prisma un `clinicId: undefined` BORRA el filtro y devuelve las filas de
 * TODAS las clínicas: el horario de un doctor ajeno podría acabar cerrando
 * huecos de éste si compartieran id en un doble de pruebas, y en producción
 * sería leer lo que no es tuyo. Sin clínica no se consulta.
 *
 * 🔴 LA TABLA PUEDE NO EXISTIR TODAVÍA, Y ESO NO PUEDE TUMBAR LA AGENDA
 *
 * El SQL lo aplica Rafael A MANO. Entre que el código se integra y él pega
 * sql/doctor-horarios.sql, `doctor_schedules` no existe. Si esta lectura
 * lanzara, se caerían a la vez la reserva pública, el bot, el portal y la
 * agenda del panel de TODAS las clínicas. Tabla ausente → mapa vacío → nadie
 * tiene horario propio → todo se calcula exactamente como antes de esta tarea.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { prisma } from "@/lib/prisma";
import { agendaFlexibleEncendida, type BanderasDb } from "@/lib/agenda/agenda-flexible.server";
import type { DiaHorario, HorariosDeDoctores } from "./core";

/**
 * La rendija de lectura, para que Sabina pase SU cliente y las pruebas uno de
 * mentira. Solo lectura, igual que `BloqueosDb`.
 */
export interface HorariosDb extends BanderasDb {
  doctorSchedule?: { findMany(args: any): Promise<any[]> };
}

/** ¿El error es «esa tabla/columna no existe»? Mismo criterio que los bloqueos. */
export function esTablaAusente(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "P2021" || code === "42P01";
}

/**
 * EL HORARIO PROPIO de estos doctores, como `doctorId → filas`.
 *
 * Solo aparecen los doctores QUE TIENEN filas: un doctor ausente del mapa
 * hereda el horario de la clínica (regla 1 del core).
 *
 * `doctorIds`: si se pasa, solo esos. Una lista VACÍA devuelve un mapa vacío
 * sin consultar — no «todos»: quien pregunta por nadie no quiere a todos.
 * Sin `doctorIds`, los de toda la clínica.
 */
export async function leerHorariosDeDoctores(
  clinicId: string,
  opciones: { doctorIds?: readonly string[]; db?: HorariosDb } = {},
): Promise<Map<string, DiaHorario[]>> {
  const mapa = new Map<string, DiaHorario[]>();
  // Corta ANTES de consultar: un clinicId vacío no filtra, devuelve el mundo.
  if (!clinicId || typeof clinicId !== "string") return mapa;
  const ids = opciones.doctorIds ? [...new Set(opciones.doctorIds.filter(Boolean))] : null;
  if (ids && ids.length === 0) return mapa;

  const db = opciones.db ?? (prisma as unknown as HorariosDb);
  // El cliente puede no tener el modelo: Sabina pasa su rendija de lectura y
  // en pruebas es un doble que solo declara lo que esa prueba necesita. Sin
  // esto, las pruebas de agenda anteriores a esta tarea reventarían con un
  // «findMany of undefined» que no dice nada.
  if (typeof db?.doctorSchedule?.findMany !== "function") return mapa;

  // WS1-T5 — la hora de comida solo se lee con la bandera `agenda-flexible`
  // de ESTA clínica Y con las columnas ya creadas (sql/salamanca-agenda.sql).
  // Sin las dos cosas el `select` es el de siempre: pedir una columna que no
  // existe daría P2022 y tumbaría a la vez el bot, la web y la agenda.
  const conComida = await comidaActiva(clinicId, opciones.db);

  try {
    const filas = await db.doctorSchedule.findMany({
      where: { clinicId, ...(ids ? { doctorId: { in: ids } } : {}) },
      select: {
        doctorId: true,
        dayOfWeek: true,
        enabled: true,
        openTime: true,
        closeTime: true,
        ...(conComida ? { lunchStart: true, lunchEnd: true } : {}),
      },
      orderBy: [{ doctorId: "asc" }, { dayOfWeek: "asc" }],
    });
    for (const f of filas) {
      const doctorId = String(f.doctorId);
      const dia: DiaHorario = {
        dayOfWeek: Number(f.dayOfWeek),
        enabled: f.enabled === true,
        openTime: String(f.openTime ?? ""),
        closeTime: String(f.closeTime ?? ""),
      };
      if (conComida && typeof f.lunchStart === "string" && typeof f.lunchEnd === "string") {
        dia.lunchStart = f.lunchStart;
        dia.lunchEnd = f.lunchEnd;
      }
      const lista = mapa.get(doctorId);
      if (lista) lista.push(dia);
      else mapa.set(doctorId, [dia]);
    }
    return mapa;
  } catch (err) {
    if (esTablaAusente(err)) {
      avisaTablaAusenteUnaVez();
      return new Map();
    }
    throw err;
  }
}

/** Atajo para UN doctor: sus filas, o `null` si hereda. */
export async function leerHorarioDeDoctor(
  clinicId: string,
  doctorId: string,
  opciones: { db?: HorariosDb } = {},
): Promise<DiaHorario[] | null> {
  if (!doctorId) return null;
  const mapa = await leerHorariosDeDoctores(clinicId, { doctorIds: [doctorId], db: opciones.db });
  return mapa.get(doctorId) ?? null;
}

/**
 * El mapa convertido en objeto plano, para mandarlo en un JSON. Solo con los
 * doctores que tienen horario propio: un id ausente = hereda.
 */
export function horariosComoObjeto(
  horarios: HorariosDeDoctores,
): Record<string, DiaHorario[]> {
  const out: Record<string, DiaHorario[]> = {};
  horarios.forEach((filas, doctorId) => {
    out[doctorId] = [...filas].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  });
  return out;
}

// ── La hora de comida (WS1-T5) ─────────────────────────────────────────

const RECORDAR_AUSENCIA_MS = 10 * 60 * 1000;
const CLAVE_COLUMNAS = Symbol.for("dalecontrol.horarioDoctor.columnasComida");
type Sonda = { existe: boolean; at: number };
const memoria = globalThis as unknown as Record<symbol, Sonda | undefined>;

/**
 * ¿Existen ya `doctor_schedules."lunchStart"/"lunchEnd"`? Por
 * `information_schema` (nunca falla) y recordado en `globalThis`: una
 * respuesta «no» se vuelve a preguntar a los 10 min, una «sí» ya no.
 */
export async function columnasComidaExisten(forzar = false): Promise<boolean> {
  const s = memoria[CLAVE_COLUMNAS];
  if (!forzar && s && (s.existe || Date.now() - s.at < RECORDAR_AUSENCIA_MS)) return s.existe;
  try {
    const filas = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'doctor_schedules'
         AND column_name IN ('lunchStart', 'lunchEnd')`;
    const existe = Number(filas[0]?.n ?? 0) === 2;
    memoria[CLAVE_COLUMNAS] = { existe, at: Date.now() };
    return existe;
  } catch (e) {
    console.warn("[horario-doctor] no se pudo comprobar las columnas de la comida:", e);
    return false;
  }
}

/** Bandera de la clínica encendida Y columnas creadas. Ante cualquier duda, `false`. */
export async function comidaActiva(clinicId: string, db?: BanderasDb): Promise<boolean> {
  if (!(await agendaFlexibleEncendida(clinicId, db ? { db } : {}))) return false;
  return columnasComidaExisten();
}

let yaAvisado = false;
function avisaTablaAusenteUnaVez(): void {
  if (yaAvisado) return;
  yaAvisado = true;
  console.warn(
    "[horario-doctor] la tabla doctor_schedules no existe todavía: " +
      "aplica sql/doctor-horarios.sql. Hasta entonces ningún doctor tiene " +
      "horario propio y la disponibilidad se calcula como antes.",
  );
}
