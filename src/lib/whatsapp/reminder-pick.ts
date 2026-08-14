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
  /**
   * `patientId` es opcional a propósito: solo lo necesita
   * `actionablePatientIds` (desambiguar teléfonos compartidos) y así las filas
   * de Prisma y los objetos literales de los tests siguen cumpliendo el tipo.
   */
  appointment: { status: string; patientId?: string | null } | null;
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

/**
 * Ids de paciente DISTINTOS entre los recordatorios accionables.
 *
 * Un mismo teléfono puede pertenecer a varios pacientes de la clínica (caso
 * real: hermanos con el celular de la mamá). Si dos de ellos tienen cita por
 * confirmar al mismo tiempo, un "CONFIRMAR" a secas no dice de quién es: hay
 * que preguntarle a una persona, no adivinar y confirmarle la cita al hermano.
 */
export function actionablePatientIds<T extends PickableReminder>(
  reminders: readonly T[],
): string[] {
  const ids: string[] = [];
  for (const r of reminders) {
    if (!isActionableReminder(r)) continue;
    const pid = r.appointment?.patientId ?? null;
    if (pid && !ids.includes(pid)) ids.push(pid);
  }
  return ids;
}

export type ReminderReplyTarget<T> = {
  /** Fila donde se guarda `patientReply`/`repliedAt` (null = no hacer nada). */
  reminder: T | null;
  /** Qué hacer con la cita. "none" = guardar la respuesta y no tocarla. */
  action: ReminderReply;
  /**
   * true = lo ÚLTIMO que recibió el paciente SÍ le pedía confirmar o cancelar,
   * y no se entendió qué contestó. Es la única situación en la que tiene
   * sentido pedirle que aclare: hacerlo tras una encuesta ("¿cómo te sentiste?"
   * → "todo bien") sería responderle un sinsentido.
   */
  unclear: boolean;
};

/**
 * Decide de una sola vez sobre qué recordatorio se registra la respuesta y qué
 * se hace con la cita.
 *
 * - Sin accionable → la respuesta se registra sobre el más reciente (para que
 *   el hilo no quede pendiente para siempre) y NINGUNA cita se toca.
 * - Con accionable Y texto entendido (confirmar/cancelar) → se registra ahí y
 *   se actúa.
 * - Con accionable pero texto NO entendido → se registra sobre el más reciente
 *   (es a lo que contesta) y el accionable NO se toca: el webhook lo deja
 *   abierto para que el siguiente intento del paciente —el que escriba bien—
 *   todavía pueda confirmar. Marcar el accionable aquí es justo lo que quemaba
 *   el recordatorio con un dedazo ("Confirmarr") y dejaba la cita sin confirmar
 *   para siempre.
 * - Lista vacía → `{ reminder: null, action: "none", unclear: false }`.
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
  const latest = reminders[0] ?? null;
  const actionable = pickActionableReminder(reminders);
  if (!actionable || !latest) return { reminder: latest, action: "none", unclear: false };

  const action = classifyReminderReply(text);
  if (action === "none") {
    return { reminder: latest, action: "none", unclear: asksToConfirmOrCancel(latest) };
  }
  if (action === "cancel" && latest !== actionable && !asksToConfirmOrCancel(latest)) {
    return { reminder: latest, action: "none", unclear: false };
  }
  return { reminder: actionable, action, unclear: false };
}
