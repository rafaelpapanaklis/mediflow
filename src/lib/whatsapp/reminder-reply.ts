// Clasificación PURA de la respuesta del paciente a un recordatorio de cita.
// Importa solo los parsers puros de booking-parse (sin Prisma), así el webhook
// y los tests comparten exactamente la misma lógica.

import { isAffirmative, isNegative, isCancelWord } from "./bot/booking-parse";

export type ReminderReply = "confirm" | "cancel" | "none";

/**
 * Interpreta la respuesta a un recordatorio. CANCELAR se evalúa PRIMERO: en
 * frases ambiguas ("mejor no, sí cancélala") debe ganar cancelar. "1"/"2" solo
 * por igualdad exacta. `text` debe venir en minúsculas y trimmed (como el webhook).
 */
export function classifyReminderReply(text: string): ReminderReply {
  const isCancel = text === "2" || isCancelWord(text) || isNegative(text);
  if (isCancel) return "cancel";
  const isConfirm = text === "1" || isAffirmative(text);
  return isConfirm ? "confirm" : "none";
}
