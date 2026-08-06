// Valores canónicos de las columnas TEXT de WhatsAppReminder (status y type).
//
// La columna whatsapp_reminders.status es TEXT en la base real (la tabla se
// creó/alteró vía sql/ manual, nunca con prisma migrate); el enum de Postgres
// "WhatsAppReminderStatus" JAMÁS existió en prod y por eso el schema modela
// el campo como String. Centraliza aquí los valores para no regar literales.
//
// 'ACTIVE' es un valor legacy (filas de mayo 2026, anteriores al enum) que se
// trata como pendiente: el worker lo incluye en el barrido y lo normaliza al
// procesar (claim → SENT, o FAILED/CANCELLED según resultado).

import { APPT_AUTO_TYPE } from "@/lib/reminders/config";

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

// ════════════════════════════════════════════════════════════════════════════
// Tipos canónicos de WhatsAppReminder.type
//
// `type` también es TEXT y la escriben ~10 productores distintos: recordatorio
// automático de cita (APPT_AUTO), envío manual (MANUAL), recall (RECALL),
// cumpleaños (BIRTHDAY), encuesta post-cita (FOLLOWUP), seguimiento de
// tratamiento (TREATMENT_FOLLOWUP) y los clínicos por especialidad
// (ENDO / PERIO / ORTHO / IMPLANT).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Únicos tipos cuyo mensaje pide al paciente CONFIRMAR o CANCELAR su cita.
 * El resto son avisos o encuestas: su respuesta se guarda, pero JAMÁS puede
 * mover el estado de una cita (una encuesta FOLLOWUP contestada con "no" no es
 * una cancelación).
 */
export const WA_REMINDER_CONFIRMABLE_TYPES: string[] = [
  APPT_AUTO_TYPE, // "APPT_AUTO" — encolador automático (lib/reminders/enqueue)
  "APPOINTMENT",  // default de la columna: filas legacy de recordatorio de cita
  "MANUAL",       // envío manual desde POST /api/whatsapp/send
];

/**
 * Estados de cita sobre los que una respuesta al recordatorio SÍ puede actuar.
 * Es exactamente el mismo conjunto con el que el encolador elige candidatas
 * (lib/reminders/enqueue.ts): si una cita ya pasó por check-in, se atendió, se
 * canceló o se marcó como no-show, contestar el WhatsApp no debe reescribirla.
 */
export const WA_REMINDER_REPLYABLE_APPT_STATUSES: string[] = [
  "PENDING",
  "SCHEDULED",
  "CONFIRMED",
];
