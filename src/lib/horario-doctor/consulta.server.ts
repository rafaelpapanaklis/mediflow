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
import type { DiaHorario, HorariosDeDoctores } from "./core";

/**
 * La rendija de lectura, para que Sabina pase SU cliente y las pruebas uno de
 * mentira. Solo lectura, igual que `BloqueosDb`.
 */
export interface HorariosDb {
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

  try {
    const filas = await db.doctorSchedule.findMany({
      where: { clinicId, ...(ids ? { doctorId: { in: ids } } : {}) },
      select: { doctorId: true, dayOfWeek: true, enabled: true, openTime: true, closeTime: true },
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
