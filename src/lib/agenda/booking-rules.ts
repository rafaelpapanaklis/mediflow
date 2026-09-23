/**
 * Reglas de agendar que antes vivían SOLO en el formulario (WS1-T3, hallazgos
 * N13 y N1 del mapa de escritura de Sabina).
 *
 * El servidor las aceptaba todas: mientras el único que escribía era la
 * pantalla no se notaba, pero cualquier otro llamador —Sabina, una integración—
 * agendaba en el pasado, a pacientes archivados y movía citas ya cerradas.
 * Copiarlas en cada llamador es justo lo que desvió a `bot-booking-service`, así
 * que viven aquí una sola vez y las aplican `POST /api/appointments` y
 * `PATCH /api/appointments/:id`.
 *
 * Funciones puras (sin prisma): el handler carga los datos y traduce el
 * resultado a HTTP. El módulo también lo importa la pantalla para mostrar la
 * frase (`bookingRuleMessage`).
 *
 * Qué NO está aquí, a propósito:
 *  - El horario de la clínica: AVISA y guarda desde P1-13 (`scheduleViolation`).
 *  - El sillón obligatorio: /dashboard/appointments no tiene selector de sillón
 *    y crea teleconsultas; exigirlo en el servidor dejaría a esa pantalla sin
 *    poder agendar en cualquier clínica con sillones.
 */

/**
 * Cuánto antes de ahora puede empezar una cita sin contar como «en el pasado»:
 * un hueco de la clínica más 15 minutos.
 *
 * - El hueco que está corriendo sigue siendo agendable: hoy la recepción hace
 *   clic en las 10:00 a las 10:10 para registrar al paciente que llegó sin cita,
 *   y eso no debe romperse.
 * - Los 15 minutos son el rato de llenar el formulario (buscar o dar de alta al
 *   paciente): la regla se mide al GUARDAR, no al hacer clic. También cubren la
 *   diferencia entre el reloj del navegador y el del servidor.
 */
export function pastToleranceMs(slotMinutes: number | null | undefined): number {
  const slot = typeof slotMinutes === "number" && slotMinutes > 0 ? slotMinutes : 0;
  return (slot + 15) * 60_000;
}

/** Los mismos tres estados con los que la tarjeta de la Agenda deshabilita el arrastre. */
export const NOT_MOVABLE_STATUSES = ["CANCELLED", "COMPLETED", "NO_SHOW"] as const;

export type BookingRuleCode =
  | "missing_reason"
  | "appointment_in_past"
  | "patient_archived"
  | "appointment_not_movable"
  // WS1-T5: la clínica eligió «No» en «¿Recepción puede agendar sobre un día
  // bloqueado?». Quién queda fuera lo decide `puedeAgendarEncima`
  // (agenda-bloqueos/core.ts); la frase, `fraseBloqueoProhibido`.
  | "blocked_slot_not_allowed";

const BOOKING_RULE_CODES: readonly BookingRuleCode[] = [
  "missing_reason",
  "appointment_in_past",
  "patient_archived",
  "appointment_not_movable",
  "blocked_slot_not_allowed",
];

/**
 * Violación de una regla. `error` es el código estable (para Sabina y la
 * pantalla), `reason` la frase que se le puede enseñar tal cual a una persona.
 * Nunca es 403: una regla de agenda no es falta de permiso.
 */
export interface BookingRuleViolation {
  httpStatus: 400 | 409 | 422;
  error: BookingRuleCode;
  reason: string;
  /** Estado de la cita, en `appointment_not_movable`. */
  status?: string;
}

const NOT_MOVABLE_REASON: Record<(typeof NOT_MOVABLE_STATUSES)[number], string> = {
  CANCELLED: "Esta cita está cancelada; no se puede mover. Si hace falta, agenda una cita nueva.",
  COMPLETED: "Esta cita ya está completada; no se puede mover.",
  NO_SHOW: "Esta cita está marcada como «No asistió»; no se puede mover. Si hace falta, agenda una cita nueva.",
};

/** Mismo minuto: los formularios reenvían la hora sin segundos y eso no es «mover». */
function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

function isBlank(reason: unknown): boolean {
  return typeof reason !== "string" || reason.trim().length === 0;
}

function missingReason(): BookingRuleViolation {
  return {
    httpStatus: 400,
    error: "missing_reason",
    reason: "Falta el motivo de la cita.",
  };
}

function inPast(
  startsAt: Date,
  now: Date,
  slotMinutes: number | null | undefined,
  verb: "agendar" | "mover",
): BookingRuleViolation | null {
  if (startsAt.getTime() >= now.getTime() - pastToleranceMs(slotMinutes)) return null;
  return {
    httpStatus: 422,
    error: "appointment_in_past",
    reason:
      verb === "agendar"
        ? "No se puede agendar una cita en una fecha u hora que ya pasó."
        : "No se puede mover la cita a una fecha u hora que ya pasó.",
  };
}

function archived(patientStatus: string | null | undefined): BookingRuleViolation | null {
  if (patientStatus !== "ARCHIVED") return null;
  return {
    httpStatus: 422,
    error: "patient_archived",
    reason: "El paciente está archivado. Reactívalo antes de agendarle una cita.",
  };
}

/** Reglas para CREAR una cita. `reason` es el campo tal como llegó en el cuerpo. */
export function newAppointmentRuleViolation(input: {
  startsAt: Date;
  reason: unknown;
  patientStatus: string | null | undefined;
  /** `defaultSlotMinutes` de la clínica: fija la tolerancia de «en el pasado». */
  slotMinutes: number | null | undefined;
  now: Date;
}): BookingRuleViolation | null {
  if (isBlank(input.reason)) return missingReason();
  return (
    inPast(input.startsAt, input.now, input.slotMinutes, "agendar") ??
    archived(input.patientStatus)
  );
}

/**
 * Reglas para EDITAR una cita. Solo cuenta como mover cambiar la hora de inicio
 * o el doctor: editar el motivo o las notas de una cita cerrada (el modal Editar
 * reenvía la hora y el doctor sin tocarlos) sigue permitido. No cuentan:
 *  - el fin: el modal Editar redondea la duración a un mínimo de 15 min y
 *    reenvía un fin distinto para las citas cortas;
 *  - el sillón: /dashboard/appointments manda `resourceId: null` al editar.
 * Ninguno de los dos debe impedir corregir el motivo de una cita completada.
 *
 * `reason` es `undefined` cuando el cuerpo no lo trae (no se toca el motivo).
 * Un motivo en blanco solo se rechaza si BORRA uno que había: /dashboard/appointments
 * reenvía el motivo entero al editar, y una cita vieja que ya lo tenía vacío no
 * debe quedar sin poder corregir sus notas.
 */
export function rescheduleRuleViolation(input: {
  current: { status: string; startsAt: Date; doctorId: string; reason: string | null };
  next: { startsAt: Date; doctorId: string };
  reason: unknown;
  patientStatus: string | null | undefined;
  /** `defaultSlotMinutes` de la clínica: fija la tolerancia de «en el pasado». */
  slotMinutes: number | null | undefined;
  now: Date;
}): BookingRuleViolation | null {
  const { current, next } = input;
  const startMoved = !sameMinute(current.startsAt, next.startsAt);
  const moved = startMoved || current.doctorId !== next.doctorId;

  const status = current.status as (typeof NOT_MOVABLE_STATUSES)[number];
  if (moved && NOT_MOVABLE_STATUSES.includes(status)) {
    return {
      httpStatus: 409,
      error: "appointment_not_movable",
      reason: NOT_MOVABLE_REASON[status],
      status: current.status,
    };
  }
  if (input.reason !== undefined && isBlank(input.reason) && !isBlank(current.reason)) {
    return missingReason();
  }
  if (!startMoved) return null;
  return (
    inPast(next.startsAt, input.now, input.slotMinutes, "mover") ??
    archived(input.patientStatus)
  );
}

/**
 * Agendar o mover encima de un bloqueo con la clínica en «No». 422 y no 403:
 * no es que falte un permiso de agenda, es una regla que la clínica puso.
 */
export function blockedSlotNotAllowed(reason: string): BookingRuleViolation {
  return { httpStatus: 422, error: "blocked_slot_not_allowed", reason };
}

/** Cuerpo JSON de la violación, con la misma forma `{ error, reason }` que `invalid_transition`. */
export function bookingRuleBody(v: BookingRuleViolation) {
  return { error: v.error, reason: v.reason, ...(v.status ? { status: v.status } : {}) };
}

/** La frase para la pantalla si la respuesta es un error de estas reglas; `null` si es otro error. */
export function bookingRuleMessage(body: { error?: unknown; reason?: unknown } | null | undefined): string | null {
  if (!body || !BOOKING_RULE_CODES.includes(body.error as BookingRuleCode)) return null;
  return typeof body.reason === "string" && body.reason ? body.reason : null;
}
