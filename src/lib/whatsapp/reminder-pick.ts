// Selección PURA del recordatorio sobre el que actúa la respuesta del paciente.
//
// El webhook lee los WhatsAppReminder SENT sin contestar de ese paciente (del
// más reciente al más viejo) y tiene que decidir DOS cosas distintas:
//   1. sobre cuál se registra la respuesta (`patientReply`/`repliedAt`), y
//   2. si esa respuesta puede mover el estado de una cita.
// Confundir ambas era el bug M-04: contestar la encuesta post-cita (FOLLOWUP)
// reabría o cancelaba una cita ya atendida —probablemente facturada—.
//
// Vive aparte del route para poder testearlo sin BD ni Meta, igual que
// `classifyReminderReply`.

import { classifyReminderReply, type ReminderReply } from "./reminder-reply";
import {
  WA_REMINDER_CONFIRMABLE_TYPES,
  WA_REMINDER_REPLYABLE_APPT_STATUSES,
} from "./reminder-status";

/**
 * Forma mínima que necesita la selección. Las filas de Prisma
 * (`whatsAppReminder.findMany({ include: { appointment: true } })`) la cumplen
 * de sobra; los tests pasan objetos literales.
 */
export type PickableReminder = {
  type: string;
  appointment: { status: string } | null;
};

/**
 * ¿El mensaje que recibió el paciente le PEDÍA confirmar o cancelar?
 * Es solo el tipo: APPT_AUTO (encolador automático), APPOINTMENT (default de la
 * columna, filas legacy) o MANUAL. Una encuesta, un recall o un cumpleaños no
 * piden nada sobre la agenda, así que un "sí"/"no" contestado a ELLOS no es una
 * orden sobre una cita.
 */
export function asksToConfirmOrCancel(reminder: PickableReminder): boolean {
  return WA_REMINDER_CONFIRMABLE_TYPES.includes(reminder.type);
}

/**
 * ¿Este recordatorio autoriza a confirmar/cancelar la cita?
 * Las tres puertas juntas: el mensaje PIDE confirmar/cancelar, la cita existe,
 * y sigue viva (PENDING / SCHEDULED / CONFIRMED). Una cita ya atendida,
 * cancelada o no-show no se reescribe.
 */
export function isActionableReminder(reminder: PickableReminder): boolean {
  return (
    asksToConfirmOrCancel(reminder) &&
    !!reminder.appointment &&
    WA_REMINDER_REPLYABLE_APPT_STATUSES.includes(reminder.appointment.status)
  );
}

/**
 * El accionable más reciente de la lista, o null si ninguno lo es.
 * `reminders` viene ordenado por `sentAt` desc: se prioriza el que de verdad
 * pide confirmar/cancelar aunque haya otro más nuevo que no lo pide.
 */
export function pickActionableReminder<T extends PickableReminder>(
  reminders: readonly T[],
): T | null {
  return reminders.find((r) => isActionableReminder(r)) ?? null;
}

export type ReminderReplyTarget<T> = {
  /** Fila donde se guarda `patientReply`/`repliedAt` (null = no hacer nada). */
  reminder: T | null;
  /** Qué hacer con la cita. "none" = guardar la respuesta y no tocarla. */
  action: ReminderReply;
};

/**
 * Decide de una sola vez sobre qué recordatorio se registra la respuesta y qué
 * se hace con la cita.
 *
 * - Sin accionable → la respuesta se registra sobre el más reciente (para que
 *   el hilo no quede pendiente para siempre) y NINGUNA cita se toca.
 * - Con accionable → se registra ahí y el texto se interpreta.
 * - Lista vacía → `{ reminder: null, action: "none" }`.
 *
 * CANCELAR pide una condición más: que el ÚLTIMO mensaje que recibió el
 * paciente le haya pedido confirmar o cancelar algo.
 *
 * WhatsApp no dice a QUÉ mensaje responde el paciente, así que hay que leerlo
 * de lo último que se le mandó:
 * - Si lo último fue una ENCUESTA o un aviso (no pide nada sobre la agenda),
 *   "no tuve dolor" clasifica como cancelar por el "no" suelto y le borraría
 *   una cita FUTURA que sí quiere, con "❌ Tu cita ha sido cancelada" incluido.
 *   Ahí la respuesta se registra sobre la encuesta y ninguna cita se toca.
 * - Si lo último SÍ le pedía confirmar/cancelar —aunque esa cita ya se haya
 *   cerrado (asistió y quedó COMPLETED)—, su "cancelar" es coherente con lo que
 *   se le pidió y se aplica al recordatorio vivo. Bloquearlo dejaría al paciente
 *   escribiendo la palabra que el propio mensaje le pide sin que pase nada NI
 *   le conteste nadie, y a la clínica esperándolo.
 *
 * Confirmar no lleva esa condición: el punto 3 del encargo es que una encuesta
 * encima no impida confirmar la cita viva. El coste, dicho sin adornos, es que
 * un "sí, todo excelente" contestado a la encuesta puede marcar CONFIRMED la
 * cita de la semana que viene y mandarle al paciente un ✅ con esa fecha. Molesta,
 * pero no le quita nada; cancelar de más sí.
 *
 * `text` debe venir en minúsculas y trimmed (como lo pasa el webhook).
 */
export function resolveReminderReply<T extends PickableReminder>(
  reminders: readonly T[],
  text: string,
): ReminderReplyTarget<T> {
  const actionable = pickActionableReminder(reminders);
  if (!actionable) return { reminder: reminders[0] ?? null, action: "none" };

  const action = classifyReminderReply(text);
  const latest = reminders[0];
  if (action === "cancel" && latest !== actionable && !asksToConfirmOrCancel(latest)) {
    return { reminder: latest, action: "none" };
  }
  return { reminder: actionable, action };
}
