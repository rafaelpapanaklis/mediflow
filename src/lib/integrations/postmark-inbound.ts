import "server-only";

/**
 * Wrapper de Postmark Inbound: cada clínica tiene una dirección única
 * (clinica-abc@inbox.mediflow.app) que apunta a este webhook. Postmark
 * parsea el email y nos lo manda como JSON.
 *
 * https://postmarkapp.com/developer/user-guide/inbound/parse-an-email
 */

export interface PostmarkInboundPayload {
  FromName?: string;
  From: string;
  To: string;
  ToFull?: { Email: string; Name?: string }[];
  Cc?: string;
  Subject: string;
  MessageID: string;
  Date: string;
  TextBody: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  Attachments?: Array<{
    Name: string;
    ContentType: string;
    Content: string; // base64
    ContentLength: number;
  }>;
  MailboxHash?: string; // ej: "clinica-abc" si la dirección es clinica-abc@inbox.mediflow.app
}

/**
 * Extrae la dirección de "clinic mailbox" del To. Si la cuenta usa
 * direcciones tipo "clinica-abc@inbox.mediflow.app", devuelve "clinica-abc".
 */
export function extractClinicMailbox(to: string): string | null {
  const m = to.match(/^([^@]+)@/);
  return m?.[1] ?? null;
}

/**
 * Convierte attachments base64 → archivos cargables. NO sube a storage por
 * defecto; el caller decide.
 */
export interface ParsedAttachment {
  name: string;
  mime: string;
  size: number;
  /** Buffer con el contenido binario decodificado. */
  buffer: Buffer;
}

export function parseAttachments(
  attachments: PostmarkInboundPayload["Attachments"],
): ParsedAttachment[] {
  if (!attachments || attachments.length === 0) return [];
  return attachments.map((a) => ({
    name: a.Name,
    mime: a.ContentType,
    size: a.ContentLength,
    buffer: Buffer.from(a.Content, "base64"),
  }));
}

/**
 * Verifica que el webhook viene de Postmark vía un secret compartido.
 * Postmark soporta basic auth en el webhook URL (e.g.
 * https://user:pass@yourdomain.com/api/webhooks/postmark/inbound).
 * Acá comparamos el header Authorization con un secret del env var.
 */
export function verifyPostmarkSecret(
  expected: string | null | undefined,
  authHeader: string | null,
): boolean {
  if (!expected) return process.env.NODE_ENV !== "production";
  if (!authHeader) return false;
  // Postmark no firma con HMAC; usa basic auth opcional. Comparamos token plano.
  const token = authHeader.replace(/^Bearer\s+|^Basic\s+/i, "").trim();
  return token === expected;
}
