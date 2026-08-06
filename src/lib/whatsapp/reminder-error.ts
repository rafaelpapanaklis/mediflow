// Traducción del error crudo de un WhatsAppReminder a un motivo legible.
//
// Hoy el error de Meta llega APLANADO a string (`err.error.message` en
// src/lib/whatsapp.ts): el código numérico se perdió como campo, pero Meta lo
// incluye dentro del propio texto ("(#131047) Message failed to send because
// more than 24 hours have passed…"), así que se puede reconocer por contenido.
// Cuando se propague el código real, este helper puede recibirlo directo sin
// cambiar a sus consumidores.
//
// PURO: sin Prisma ni React. La clave que devuelve la traduce la UI con el mapa
// REMINDER_REASON_KEY de `dashboard/whatsapp/whatsapp-client.tsx`, que la lleva
// a `inbox.whatsapp.reason<Key>` (es/en). Ese mapa es un Record sobre la unión
// de abajo: agregar aquí una clave sin traducirla allí NO compila.

export type ReminderErrorKey =
  /** 131047 — fuera de la ventana de 24 h: hace falta plantilla aprobada. */
  | "outside24h"
  /** 131026 / 131052 — el número no puede recibir el mensaje. */
  | "undeliverable"
  /** 190 / 401 — el token de Meta caducó o fue revocado. */
  | "tokenExpired"
  /** La clínica no tiene WhatsApp conectado (pre-check del worker). */
  | "notConnected"
  /** Ni teléfono ni paciente resoluble para ese recordatorio. */
  | "noPhone"
  /** Canal email: el paciente no tiene correo o el proveedor no entregó. */
  | "emailIssue"
  /** Estuvo en cola más de 7 días y se expiró en vez de enviarse tarde. */
  | "expired"
  /** La cita se canceló, se cerró o ya había empezado al momento del envío. */
  | "apptClosed"
  /** No se pudo construir el cuerpo (plantilla desconocida). */
  | "renderFailed"
  /** Meta rechazó por límite de frecuencia / capacidad. */
  | "rateLimited";

// Orden IMPORTA: gana la primera que casa. Los patrones propios del producto
// (mensajes que escribe nuestro worker) van antes que los de Meta para que un
// texto en español no caiga en una heurística en inglés.
const PATTERNS: Array<{ key: ReminderErrorKey; re: RegExp }> = [
  // ── Motivos que escribe nuestro propio worker (lib/whatsapp/queue-worker) ──
  { key: "notConnected", re: /whatsapp no conectado/i },
  { key: "noPhone",      re: /sin tel[eé]fono ni paciente/i },
  { key: "emailIssue",   re: /paciente sin email|email no entregado/i },
  { key: "expired",      re: /expirado: pendiente/i },
  { key: "apptClosed",   re: /cita cancelada, cerrada o ya iniciada/i },
  { key: "renderFailed", re: /no se pudo construir el cuerpo/i },

  // ── Errores de Meta (Cloud API) ────────────────────────────────────────────
  // 131047: "more than 24 hours have passed since the customer last replied".
  { key: "outside24h",    re: /131047|more than 24 hours|re-?engagement/i },
  // 131026: el destinatario no puede recibir el mensaje. NO se meten aquí
  // 131051/131052 (tipo de mensaje o media inválidos): esos hablan de lo que
  // mandamos nosotros, y traducirlos a "el número no recibe" sería mentir —
  // mejor que caigan a null y se muestre el error crudo.
  { key: "undeliverable", re: /131026|undeliverable/i },
  // 190 nunca viene con "(#190)": Meta lo manda como texto de OAuth.
  { key: "tokenExpired",  re: /session has expired|access token|oauth ?exception|\(#190\)/i },
  // 131056 / 130429: throughput de la WABA.
  { key: "rateLimited",   re: /131056|130429|rate limit|too many messages/i },
];

/**
 * Devuelve la clave del motivo, o null si el texto no coincide con ninguno
 * conocido (la UI muestra entonces el error crudo tal cual: preferimos un
 * mensaje feo y verdadero a una traducción inventada).
 */
export function describeReminderError(errorMsg: string | null | undefined): ReminderErrorKey | null {
  if (!errorMsg) return null;
  for (const { key, re } of PATTERNS) {
    if (re.test(errorMsg)) return key;
  }
  return null;
}
