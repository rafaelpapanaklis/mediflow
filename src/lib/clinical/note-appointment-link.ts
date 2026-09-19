/**
 * ¿A qué cita se liga la nota que se guarda desde el expediente?
 *
 * Archivo PURO. Lo usan las dos puntas: la ficha dental (para proponer la cita)
 * y POST /api/clinical (para decidir si la propuesta se acepta). La regla es la
 * misma en ambas y vive aquí una sola vez.
 *
 * LA REGLA: la nota se liga solo si el paciente tiene EXACTAMENTE UNA cita viva
 * ese día. Con dos o más, o con ninguna, NO se adivina: se guarda sin ligar,
 * como siempre. Ligar la nota a la cita equivocada es peor que no ligarla —
 * POST /api/appointments/[id]/complete busca la nota por
 * specialtyData.appointmentId y la firma.
 */

export interface DayAppointment {
  id: string;
  status?: string | null;
  /** Solo los conoce el servidor; la ficha propone sin ellos. */
  doctorId?: string | null;
  startsAt?: Date | string | null;
}

/** Quién escribe la nota y cuándo: lo que el servidor sabe y el cliente no. */
export interface NoteContext {
  doctorId: string;
  now: Date;
}

/**
 * Una cita que empieza dentro de más de esto todavía no es «la consulta que se
 * está escribiendo»: el paciente que viene a las 10:00 de urgencia y tiene su
 * cita a las 17:00 no está en esa cita.
 */
export const MAX_EARLY_MS = 2 * 60 * 60 * 1000;

/** Una cita cancelada o a la que el paciente no vino no es «la cita de hoy». */
const NOT_ATTENDABLE = new Set(["CANCELLED", "NO_SHOW"]);

/** Un id usable o null. Nunca lanza: lo que no sea un string razonable, fuera. */
export function sanitizeAppointmentId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > 100) return null;
  return id;
}

/** El id de LA cita del día, o null si no hay exactamente una. */
export function pickSingleAppointmentOfDay(appointments: readonly DayAppointment[]): string | null {
  const live = appointments.filter((a) => a && typeof a.id === "string" && !NOT_ATTENDABLE.has(String(a.status ?? "")));
  const ids = Array.from(new Set(live.map((a) => a.id)));
  return ids.length === 1 ? ids[0] : null;
}

/**
 * Lo que decide el servidor. `requested` es lo que mandó el cliente, sin
 * confiar en él; `todaysAppointments` son las citas de hoy de ESE paciente en
 * ESA clínica, leídas por el servidor con su filtro de tenant. Un id de otra
 * clínica o de otro paciente no puede estar en esa lista, así que se ignora.
 *
 * Y dos cosas más que solo puede mirar el servidor, las dos para no colgar la
 * nota de una cita que no es la suya:
 *   · la cita tiene que ser de QUIEN escribe la nota (no la de otro doctor);
 *   · y no puede empezar dentro de más de MAX_EARLY_MS.
 */
export function resolveNoteAppointmentId(
  requested: unknown,
  todaysAppointments: readonly DayAppointment[],
  ctx: NoteContext,
): string | null {
  const id = sanitizeAppointmentId(requested);
  if (!id) return null;
  if (pickSingleAppointmentOfDay(todaysAppointments) !== id) return null;
  const appt = todaysAppointments.find((a) => a.id === id);
  if (!appt || !ctx.doctorId || appt.doctorId !== ctx.doctorId) return null;
  const starts = appt.startsAt ? new Date(appt.startsAt).getTime() : NaN;
  if (!Number.isFinite(starts) || starts - ctx.now.getTime() > MAX_EARLY_MS) return null;
  return id;
}
