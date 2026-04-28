import "server-only";

/**
 * Wrapper de Twilio Conversations API para WhatsApp inbound + outbound.
 *
 * Decisión de arquitectura: UN número de WhatsApp por CLÍNICA (no por
 * doctor). Las credenciales viven en Clinic (twilioAccountSid /
 * twilioAuthToken / twilioWhatsappNumber).
 *
 * Stub: si las credenciales no están configuradas en la clínica devuelve
 * un mock con success=false + reason. Esto permite que el inbox funcione
 * en desarrollo sin Twilio real.
 */

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
  whatsappNumber: string; // E.164 format: "+5215512345678"
}

export interface SendWhatsappInput {
  to: string;        // E.164
  body: string;
  mediaUrls?: string[];
}

export interface SendResult {
  success: boolean;
  messageSid?: string;
  conversationSid?: string;
  error?: string;
  mock?: boolean;
}

/**
 * Envía un mensaje WhatsApp via Twilio Conversations.
 * Si no hay credenciales, retorna mock para que el flujo no se rompa.
 */
export async function sendWhatsappMessage(
  creds: Partial<TwilioCreds> | null,
  input: SendWhatsappInput,
): Promise<SendResult> {
  if (!creds?.accountSid || !creds.authToken || !creds.whatsappNumber) {
    return {
      success: false,
      error: "twilio_not_configured",
      mock: true,
    };
  }

  // Real Twilio call. Lazy-import para no cargar el SDK si la clínica no
  // tiene la integración activada. El paquete `twilio` es opcional —
  // dependiendo de instalación, el bundle puede no incluirlo.
  try {
    // dynamic import sin types (twilio peer-installed cuando se necesite)
    const mod: any = await import("twilio" as string).catch(() => null);
    const twilioFactory: any = mod?.default ?? mod;
    if (!twilioFactory) {
      return { success: false, error: "twilio_sdk_not_installed", mock: true };
    }
    const client: any = twilioFactory(creds.accountSid, creds.authToken);
    const message: any = await client.messages.create({
      from: `whatsapp:${creds.whatsappNumber}`,
      to: `whatsapp:${input.to}`,
      body: input.body,
      ...(input.mediaUrls && input.mediaUrls.length > 0
        ? { mediaUrl: input.mediaUrls }
        : {}),
    });
    return {
      success: true,
      messageSid: message?.sid as string | undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "send_failed",
    };
  }
}

/**
 * Verifica que la firma del webhook proviene de Twilio.
 * En dev (sin auth token) devuelve true sin verificar.
 */
export async function verifyTwilioSignature(
  authToken: string | null | undefined,
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!authToken || !signatureHeader) return process.env.NODE_ENV !== "production";
  try {
    const mod: any = await import("twilio" as string).catch(() => null);
    const twilioMod: any = mod?.default ?? mod;
    if (!twilioMod || typeof twilioMod.validateRequest !== "function") {
      return process.env.NODE_ENV !== "production";
    }
    return Boolean(twilioMod.validateRequest(authToken, signatureHeader, url, params));
  } catch {
    return false;
  }
}

/**
 * Parsea el payload form-encoded de un webhook Twilio WhatsApp inbound a un
 * shape estructurado utilizable por el endpoint.
 */
export interface TwilioInboundPayload {
  From: string;            // "whatsapp:+5215512345678"
  To: string;              // "whatsapp:<number-clinica>"
  Body: string;
  MessageSid: string;
  ConversationSid?: string;
  ProfileName?: string;
  NumMedia?: string;
}

export function parseInbound(form: URLSearchParams | FormData): TwilioInboundPayload {
  const get = (k: string): string => {
    const v = form instanceof FormData ? form.get(k) : form.get(k);
    return typeof v === "string" ? v : "";
  };
  return {
    From: get("From"),
    To: get("To"),
    Body: get("Body"),
    MessageSid: get("MessageSid"),
    ConversationSid: get("ConversationSid") || undefined,
    ProfileName: get("ProfileName") || undefined,
    NumMedia: get("NumMedia") || undefined,
  };
}

/** Quita el prefijo "whatsapp:" de los E.164 que vienen de Twilio. */
export function stripWhatsappPrefix(addr: string): string {
  return addr.replace(/^whatsapp:/, "");
}
