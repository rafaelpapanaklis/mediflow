// Estados canónicos de WhatsAppReminder.status.
//
// La columna whatsapp_reminders.status es TEXT en la base real (la tabla se
// creó/alteró vía sql/ manual, nunca con prisma migrate); el enum de Postgres
// "WhatsAppReminderStatus" JAMÁS existió en prod y por eso el schema modela
// el campo como String. Centraliza aquí los valores para no regar literales.
//
// 'ACTIVE' es un valor legacy (filas de mayo 2026, anteriores al enum) que se
// trata como pendiente: el worker lo incluye en el barrido y lo normaliza al
// procesar (claim → SENT, o FAILED/CANCELLED según resultado).

export const WA_REMINDER_STATUS = {
  PENDING: "PENDING",
  SENT: "SENT",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type WaReminderStatus =
  (typeof WA_REMINDER_STATUS)[keyof typeof WA_REMINDER_STATUS];

// Valor legacy fuera del set canónico — equivale a pendiente.
export const WA_REMINDER_LEGACY_ACTIVE = "ACTIVE";

// Para WHEREs de "pendiente de envío" (barrido del worker, dedupes).
export const WA_REMINDER_PENDING_STATUSES: string[] = [
  WA_REMINDER_STATUS.PENDING,
  WA_REMINDER_LEGACY_ACTIVE,
];
