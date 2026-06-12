// Lógica PURA del envío de WhatsApp desde el Inbox — sin BD ni Meta. Testable.
// La consume /api/inbox/threads/[id]/messages para decidir POR QUÉ stack sale
// el mensaje (Meta Cloud API preferido, Twilio legacy de respaldo) y si cae
// dentro de la ventana de 24h de WhatsApp.

export interface WhatsappSendClinic {
  waConnected?: boolean | null;
  waPhoneNumberId?: string | null;
  waAccessToken?: string | null;
  twilioAccountSid?: string | null;
  twilioAuthToken?: string | null;
  twilioWhatsappNumber?: string | null;
}

export type WhatsappChannelResolution =
  | { channel: "meta" }
  | { channel: "twilio" }
  | { channel: "none"; error: string };

/**
 * Decide el canal de salida del WhatsApp del Inbox:
 *   1. Meta Cloud API si la clínica está conectada (waConnected + credenciales).
 *   2. Twilio SOLO como respaldo legacy (clínica con twilio* y sin Meta).
 *   3. none → no hay forma de enviar (el caller responde con error claro).
 */
export function resolveWhatsappSendChannel(clinic: WhatsappSendClinic): WhatsappChannelResolution {
  if (clinic.waConnected && clinic.waPhoneNumberId && clinic.waAccessToken) {
    return { channel: "meta" };
  }
  if (clinic.twilioAccountSid && clinic.twilioAuthToken && clinic.twilioWhatsappNumber) {
    return { channel: "twilio" };
  }
  return { channel: "none", error: "whatsapp_not_connected" };
}

export const WHATSAPP_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Ventana de servicio de 24h de WhatsApp: con texto libre solo se puede
 * responder si el último mensaje ENTRANTE del paciente tiene <=24h. Sin mensaje
 * entrante (null) se considera fuera de ventana (iniciar conversación exige
 * plantilla aprobada, no texto libre). Devuelve true si se puede enviar.
 */
export function isWithin24hWindow(lastInboundAt: Date | string | null | undefined, now: Date): boolean {
  if (!lastInboundAt) return false;
  const ts = lastInboundAt instanceof Date ? lastInboundAt.getTime() : new Date(lastInboundAt).getTime();
  if (isNaN(ts)) return false;
  const diff = now.getTime() - ts;
  return diff >= 0 && diff <= WHATSAPP_24H_MS;
}

/** Últimos 10 dígitos, descartando todo lo no numérico. Para emparejar teléfonos. */
export function digitsLast10(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * De una lista de candidatos (pre-filtrados por la BD con un `contains` laxo),
 * elige el que coincide EXACTO por los últimos 10 dígitos normalizados en AMBOS
 * lados. Evita el falso positivo de `contains` crudo (un teléfono cuyo substring
 * coincide pero no es el mismo número). Devuelve null si ninguno calza.
 */
export function pickPatientByPhone<T extends { phone?: string | null }>(
  candidates: T[],
  fromRaw: string,
): T | null {
  const target = digitsLast10(fromRaw);
  if (target.length < 10) return null;
  return candidates.find((c) => digitsLast10(c.phone) === target) ?? null;
}
