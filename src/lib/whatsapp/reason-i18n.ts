// Motivo de fallo (ReminderErrorKey) → clave de traducción.
//
// Vive aparte porque lo usan DOS pantallas: el panel de recordatorios
// (/dashboard/whatsapp) y las burbujas del Inbox. Tenerlo duplicado hacía que
// un motivo nuevo se tradujera en una y saliera crudo en la otra.
//
// Es un Record sobre la unión COMPLETA de ReminderErrorKey a propósito: añadir
// una clave en reminder-error.ts sin traducirla aquí NO compila.
//
// PURO: sin Prisma ni React (lo importan componentes cliente).

import type { ReminderErrorKey } from "./reminder-error";

export const REMINDER_REASON_KEY: Record<ReminderErrorKey, string> = {
  outside24h:            "inbox.whatsapp.reasonOutside24h",
  undeliverable:         "inbox.whatsapp.reasonUndeliverable",
  tokenExpired:          "inbox.whatsapp.reasonTokenExpired",
  notConnected:          "inbox.whatsapp.reasonNotConnected",
  noPhone:               "inbox.whatsapp.reasonNoPhone",
  emailIssue:            "inbox.whatsapp.reasonEmailIssue",
  expired:               "inbox.whatsapp.reasonExpired",
  apptClosed:            "inbox.whatsapp.reasonApptClosed",
  renderFailed:          "inbox.whatsapp.reasonRenderFailed",
  rateLimited:           "inbox.whatsapp.reasonRateLimited",
  templateNotConfigured: "inbox.whatsapp.reasonTemplateNotConfigured",
  templateRejected:      "inbox.whatsapp.reasonTemplateRejected",
  billingRequired:       "inbox.whatsapp.reasonBillingRequired",
};
