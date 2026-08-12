// Error tipado de la Graph API de WhatsApp.
//
// PROBLEMA QUE RESUELVE: `sendWhatsAppMessage` aplanaba el error de Meta a un
// string (`err.error.message`) y con él se perdía el CÓDIGO, que es el único
// dato estable de esa respuesta — el texto cambia de redacción y de idioma, el
// número no. Sin código no se puede decidir nada: ni apagar la conexión ante un
// 190, ni avisar de la falta de método de pago ante un 131042, ni traducir el
// motivo sin adivinarlo por regex sobre inglés.
//
// PURO: sin Prisma, sin React, sin "server-only". Lo importan el helper de
// envío, la cola de recordatorios y el webhook.

/** Códigos de Meta que el producto trata de forma explícita. */
export const WA_ERROR_CODE = {
  /** Fuera de la ventana de 24 h: el texto libre no sale, hace falta plantilla. */
  OUTSIDE_24H: 131047,
  /** Token caducado o revocado (OAuthException). */
  TOKEN_EXPIRED: 190,
  /** El número no tiene WhatsApp / no puede recibir. */
  UNDELIVERABLE: 131026,
  /** La plantilla no cuadra: no existe en ese idioma, no está aprobada, o el
   *  número de variables no coincide con la que Meta aprobó. */
  TEMPLATE_PARAMS_MISMATCH: 132000,
  TEMPLATE_NOT_FOUND: 132001,
  /** La WABA de la clínica no tiene método de pago válido. */
  BILLING_REQUIRED: 131042,
} as const;

export class WhatsAppApiError extends Error {
  /** `error.code` de Meta (131047, 190, 131042…). Null si la respuesta no lo trajo. */
  readonly code: number | null;
  /** `error.error_subcode`: desambigua algunos 190. */
  readonly subcode: number | null;
  /** `error.error_user_title` o `error.type`, para diagnóstico. */
  readonly title: string | null;
  /** HTTP de la respuesta — NO es el código de Meta. */
  readonly httpStatus: number;

  constructor(args: {
    message: string;
    code?: number | null;
    subcode?: number | null;
    title?: string | null;
    httpStatus: number;
  }) {
    // El mensaje lleva el código incrustado: `WhatsAppReminder.errorMsg` es
    // texto plano y es lo único que llega al panel de recordatorios.
    super(formatWaErrorMessage(args.code ?? null, args.message));
    this.name = "WhatsAppApiError";
    this.code = args.code ?? null;
    this.subcode = args.subcode ?? null;
    this.title = args.title ?? null;
    this.httpStatus = args.httpStatus;
  }
}

/**
 * Antepone `(#código)` al texto salvo que Meta ya lo incluya (lo hace en la
 * mayoría de los errores de envío, pero no en los de OAuth).
 */
export function formatWaErrorMessage(code: number | null, raw: string): string {
  const text = (raw ?? "").trim() || "Error al enviar el mensaje";
  if (code == null) return text;
  return text.includes(`(#${code})`) ? text : `(#${code}) ${text}`;
}

/**
 * Construye el error a partir del cuerpo de una respuesta fallida de la Graph
 * API. Tolera que el cuerpo NO sea el JSON esperado: Meta responde HTML en los
 * 502 de su gateway, y ahí el único dato real es el HTTP.
 */
export function parseWaError(payload: unknown, httpStatus: number): WhatsAppApiError {
  const err = (payload as { error?: Record<string, unknown> } | null)?.error;
  const num = (v: unknown): number | null =>
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

  return new WhatsAppApiError({
    message: str(err?.message) ?? `Error al enviar mensaje (HTTP ${httpStatus})`,
    code: num(err?.code),
    subcode: num(err?.error_subcode),
    title: str(err?.error_user_title) ?? str(err?.type),
    httpStatus,
  });
}

/**
 * ¿Este fallo significa que la clínica perdió la sesión con Meta?
 *
 * Solo el 190 (OAuthException) y el 401 HTTP: son inequívocos. A propósito NO
 * entra ningún otro código — apagar `waConnected` deja a la clínica SIN envíos
 * hasta que alguien vuelva a conectar a mano, así que un falso positivo aquí
 * cuesta más caro que seguir reintentando.
 */
export function isTokenRevoked(err: unknown): boolean {
  if (!(err instanceof WhatsAppApiError)) return false;
  return err.code === WA_ERROR_CODE.TOKEN_EXPIRED || err.httpStatus === 401;
}

/** ¿Meta rechazó el envío por falta de método de pago en la WABA de la clínica? */
export function isBillingError(err: unknown): boolean {
  return err instanceof WhatsAppApiError && err.code === WA_ERROR_CODE.BILLING_REQUIRED;
}

/** Código de Meta si lo hay, para persistirlo o traducirlo. */
export function waErrorCode(err: unknown): number | null {
  return err instanceof WhatsAppApiError ? err.code : null;
}

/**
 * El envío NO se intentó porque no podía llegar (fuera de la ventana de 24 h y
 * sin plantilla utilizable). No es un fallo de Meta: es una decisión nuestra,
 * tomada ANTES de gastar la llamada.
 *
 * Extiende Error para respetar el contrato de `sendWhatsAppLogged` —lanza y el
 * caller decide—, y su `message` es el motivo en español que acaba en
 * `WhatsAppReminder.errorMsg` y de ahí al panel.
 */
export class WhatsAppBlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WhatsAppBlockedError";
  }
}
