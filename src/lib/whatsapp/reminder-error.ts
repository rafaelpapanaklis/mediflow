// Traducción del error de un WhatsAppReminder (o de un mensaje del Inbox) a un
// motivo legible.
//
// El código de Meta es el dato FIABLE: su texto cambia de redacción y de
// idioma, el número no. Por eso `describeReminderFailure` mira primero el
// código y solo cae al reconocimiento por texto cuando no hay ninguno — que es
// el caso de las filas viejas de `WhatsAppReminder.errorMsg`, donde el código
// solo existe incrustado en la cadena ("(#131047) Message failed to send
// because more than 24 hours have passed…").
//
// PURO: sin Prisma ni React. La clave que devuelve la traduce la UI con el mapa
// REMINDER_REASON_KEY de `dashboard/whatsapp/whatsapp-client.tsx`, que la lleva
// a `inbox.whatsapp.reason<Key>` (es/en). Ese mapa es un Record sobre la unión
// de abajo: agregar aquí una clave sin traducirla allí NO compila.

import { WA_ERROR_CODE } from "./errors";

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
  | "rateLimited"
  /** La clínica no ha registrado plantilla para ese tipo de mensaje (nuestro). */
  | "templateNotConfigured"
  /** La plantilla existe pero Meta sigue revisándola (nuestro, pre-envío). */
  | "templatePending"
  /** 132000 / 132001 — Meta rechazó la plantilla (nombre, idioma o variables). */
  | "templateRejected"
  /** 131042 — la WABA de la clínica no tiene método de pago. */
  | "billingRequired";

/**
 * Códigos de Meta → motivo. Es la vía PREFERENTE: exacta, sin heurística.
 *
 * 132000 y 132001 comparten motivo a propósito. 132001 es "la plantilla no
 * existe en ese idioma o no está aprobada" y 132000 es "el número de variables
 * no coincide con la aprobada": para quien lo lee la acción es la misma —
 * revisar nombre, idioma y variables contra lo que Meta tiene aprobado— y
 * separarlos obligaría a la clínica a distinguir dos mensajes casi idénticos.
 */
const CODE_MAP: Record<number, ReminderErrorKey> = {
  [WA_ERROR_CODE.OUTSIDE_24H]: "outside24h",
  [WA_ERROR_CODE.TOKEN_EXPIRED]: "tokenExpired",
  [WA_ERROR_CODE.UNDELIVERABLE]: "undeliverable",
  [WA_ERROR_CODE.TEMPLATE_PARAMS_MISMATCH]: "templateRejected",
  [WA_ERROR_CODE.TEMPLATE_NOT_FOUND]: "templateRejected",
  [WA_ERROR_CODE.BILLING_REQUIRED]: "billingRequired",
  131052: "undeliverable",
  131056: "rateLimited",
  130429: "rateLimited",
};

/** Motivo a partir del código numérico de Meta. Null si no se reconoce. */
export function describeReminderErrorCode(
  code: number | null | undefined,
): ReminderErrorKey | null {
  if (code == null) return null;
  return CODE_MAP[code] ?? null;
}

/**
 * Motivo de un fallo: el código manda; el texto es el respaldo para las filas
 * que se guardaron antes de que se propagara el código.
 */
export function describeReminderFailure(args: {
  code?: number | null;
  errorMsg?: string | null;
}): ReminderErrorKey | null {
  return describeReminderErrorCode(args.code) ?? describeReminderError(args.errorMsg);
}

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
  // Fase 3: fuera de ventana y sin plantilla registrada para ese tipo → NO se
  // envía. Va antes que el 131047 de Meta porque ni siquiera se llegó a llamar.
  { key: "templateNotConfigured", re: /falta configurar la plantilla/i },
  // Creada dentro de la WABA pero aún en revisión / rechazada por Meta: el
  // bloqueo lo escribe send-mode antes de llamar, así que no hay código que
  // mirar. Van antes que los patrones en inglés de Meta.
  { key: "templatePending",  re: /todav[ií]a no aprueba la plantilla/i },
  { key: "templateRejected", re: /meta rechaz[oó] la plantilla/i },

  // ── Errores de Meta (Cloud API) ────────────────────────────────────────────
  // Respaldo por texto: solo entra cuando la fila no trae el código aparte.
  { key: "billingRequired", re: /131042|payment method|billing/i },
  { key: "templateRejected", re: /132000|132001|template name does not exist|template does not exist|number of parameters/i },
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
