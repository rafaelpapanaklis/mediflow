// ═══════════════════════════════════════════════════════════════════════════
// Soporte Técnico — notificaciones por email.
// Las llama src/lib/support/service.ts en cada transición. NUNCA deben tirar
// (try/catch interno + sendEmail ya es no-throwing). Asunto SIEMPRE con folio
// "[#DC-0001] ..." para que el hilo se agrupe en el cliente de correo.
//
// HTML: carcasa dark de la casa (réplica local de darkShell de
// src/lib/patient-portal/emails.ts; fondo #0b0815, card #121020, marca
// #a78bfa, botón gradiente #8b5cf6→#7c3aed). Español neutro con tú.
// Todo texto de usuario (clinicName, subject, bodyPreview, authorName,
// statusLabel) pasa por escapeHtml antes de interpolarse. Links directos:
//  - a soporte (admin):   {baseUrl}/admin/soporte/{ticketId}
//  - a la clínica:        {baseUrl}/dashboard/soporte/{ticketId}
// Base URL: NEXT_PUBLIC_APP_URL → NEXT_PUBLIC_SITE_URL → VERCEL_URL →
// fallback de producción (mismo patrón que createShareToken.ts / seo.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { sendEmail } from "@/lib/email";
import { formatFolio, SUPPORT_CATEGORY_LABELS, SUPPORT_PRIORITY_LABELS, SUPPORT_STATUS_LABELS_CLINIC } from "./types";

export interface SupportEmailContext {
  ticketId: string;
  folio: number;
  subject: string;
  clinicName: string;
  category: string;
  priority: string;
  /** Nuevo estado (solo notifyStatusChange). */
  status?: string;
  /** Primeros ~300 chars del mensaje, texto plano. */
  bodyPreview?: string;
  /** Nº de archivos adjuntos del mensaje (solo notifySupportReply). El email
   *  NUNCA adjunta el archivo (las signed URLs expiran en 1h); solo avisa. */
  attachmentCount?: number;
  authorName?: string | null;
  /** Email del usuario de la clínica que creó el ticket (destino de los
   *  correos hacia la clínica). Puede ser null → se omite el envío. */
  toEmail?: string | null;
}

/** Bandeja interna de soporte de DaleControl. */
export function getSupportInboxEmail(): string {
  return process.env.SUPPORT_EMAIL_TO ?? "soporte@dalecontrol.com";
}

function subjectWithFolio(ctx: SupportEmailContext, suffix: string): string {
  return `[${formatFolio(ctx.folio)}] ${suffix}: ${ctx.subject}`.slice(0, 180);
}

/** Escape mínimo para interpolar texto del usuario en HTML de email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Base URL absoluta de la app ──────────────────────────────────────────────
// Mismo patrón que src/app/actions/implants/createShareToken.ts
// (NEXT_PUBLIC_APP_URL → VERCEL_URL → fallback, normalizando protocolo) más
// NEXT_PUBLIC_SITE_URL como en los checkouts de ai-wallet/compras. El fallback
// final es el dominio de producción que ya usa src/lib/seo.ts.
function getBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_URL ??
    "https://www.dalecontrol.com";
  const normalized = raw.startsWith("http") ? raw : `https://${raw}`;
  return normalized.replace(/\/+$/, "");
}

function adminTicketUrl(ticketId: string): string {
  return `${getBaseUrl()}/admin/soporte/${ticketId}`;
}

function clinicTicketUrl(ticketId: string): string {
  return `${getBaseUrl()}/dashboard/soporte/${ticketId}`;
}

// ── Carcasa y bloques HTML ───────────────────────────────────────────────────

/** Carcasa dark de email de la casa. Réplica local de darkShell de
 *  src/lib/patient-portal/emails.ts (no se importa de ahí para mantener este
 *  módulo autocontenido; si cambia el estilo global, sincronizar a mano). */
function darkShell(inner: string): string {
  return `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #a78bfa; margin-bottom: 20px;">
      DaleControl
    </div>
${inner}
    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />
    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      Si tienes dudas, escríbenos a
      <a href="mailto:soporte@dalecontrol.com" style="color: #a78bfa;">soporte@dalecontrol.com</a>.
      <br /><br />
      DaleControl — Soporte técnico 🇲🇽
    </div>
  </div>
</body>
</html>`;
}

/** Título H1. Recibe HTML ya escapado por el caller. */
function heading(innerHtml: string): string {
  return `<h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">${innerHtml}</h1>`;
}

/** Párrafo estándar. Recibe HTML ya escapado por el caller. */
function paragraph(innerHtml: string): string {
  return `<p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 18px 0;">${innerHtml}</p>`;
}

/** Línea meta "Ticket #DC-0001 · {asunto}". Escapa el asunto internamente. */
function metaLine(ctx: SupportEmailContext): string {
  return `<div style="font-size: 13px; color: rgba(245,245,247,0.55); margin: 0 0 16px 0;">Ticket <strong style="color: #a78bfa;">${formatFolio(ctx.folio)}</strong> · ${escapeHtml(ctx.subject)}</div>`;
}

/** Chip pill "Etiqueta: Valor" (categoría/prioridad). Escapa internamente. */
function chip(label: string, value: string): string {
  return `<span style="display: inline-block; padding: 4px 12px; background: rgba(124,58,237,0.12); border: 1px solid rgba(167,139,250,0.35); border-radius: 999px; font-size: 12px; font-weight: 600; color: #c4b5fd; margin: 0 8px 8px 0;">${escapeHtml(label)}: ${escapeHtml(value)}</span>`;
}

/** Preview del mensaje (texto plano del usuario) en bloque con borde.
 *  Escapa internamente; vacío → no renderiza nada. */
function previewBlock(preview: string | undefined): string {
  const value = (preview ?? "").trim();
  if (!value) return "";
  return `<div style="padding: 16px 18px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-left: 3px solid #8b5cf6; border-radius: 10px; margin: 4px 0 20px 0; font-size: 14px; color: rgba(245,245,247,0.85); line-height: 1.55; white-space: pre-wrap; word-break: break-word;">${escapeHtml(value)}</div>`;
}

/** Botón gradiente de la casa + enlace plano de respaldo debajo. */
function ctaButton(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  return `<a href="${safeHref}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 15px; margin: 8px 0 16px 0;">${escapeHtml(label)}</a>
    <p style="font-size: 12px; color: rgba(245,245,247,0.5); line-height: 1.6; margin: 0;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br /><a href="${safeHref}" style="color: #a78bfa; word-break: break-all;">${safeHref}</a></p>`;
}

// ── Emails ───────────────────────────────────────────────────────────────────

/** Ticket nuevo → bandeja de soporte DaleControl. */
export async function notifyNewTicket(ctx: SupportEmailContext): Promise<void> {
  try {
    const categoryLabel = SUPPORT_CATEGORY_LABELS[ctx.category] ?? ctx.category;
    const priorityLabel = SUPPORT_PRIORITY_LABELS[ctx.priority] ?? ctx.priority;
    const author = (ctx.authorName ?? "").trim();
    const url = adminTicketUrl(ctx.ticketId);

    const html = darkShell(`
    ${heading(`Nuevo ticket de ${escapeHtml(ctx.clinicName)}`)}
    ${metaLine(ctx)}
    <div style="margin: 0 0 16px 0;">
      ${chip("Categoría", categoryLabel)}
      ${chip("Prioridad", priorityLabel)}
    </div>
    ${paragraph(`${author ? `<strong style="color: #f5f5f7;">${escapeHtml(author)}</strong> abrió` : "La clínica abrió"} un ticket nuevo con este mensaje:`)}
    ${previewBlock(ctx.bodyPreview)}
    ${ctaButton(url, "Abrir en el panel admin →")}`);

    const text =
      `Nuevo ticket de ${ctx.clinicName} (${formatFolio(ctx.folio)})\n` +
      `Asunto: ${ctx.subject}\n` +
      `Categoría: ${categoryLabel} · Prioridad: ${priorityLabel}\n` +
      (author ? `Abierto por: ${author}\n` : "") +
      `\n${(ctx.bodyPreview ?? "").trim()}\n\n` +
      `Abrir en el panel admin: ${url}`;

    await sendEmail({
      to: getSupportInboxEmail(),
      subject: subjectWithFolio(ctx, "Nuevo ticket"),
      html,
      text,
    });
  } catch (err) {
    console.error("[support.notifyNewTicket]", err);
  }
}

/** La clínica respondió → bandeja de soporte DaleControl. */
export async function notifyClinicReply(ctx: SupportEmailContext): Promise<void> {
  try {
    const author = (ctx.authorName ?? "").trim();
    const url = adminTicketUrl(ctx.ticketId);

    const html = darkShell(`
    ${heading(`${escapeHtml(ctx.clinicName)} respondió`)}
    ${metaLine(ctx)}
    ${paragraph(`${author ? `<strong style="color: #f5f5f7;">${escapeHtml(author)}</strong> escribió` : "La clínica escribió"} en el ticket:`)}
    ${previewBlock(ctx.bodyPreview)}
    ${ctaButton(url, "Abrir en el panel admin →")}`);

    const text =
      `${ctx.clinicName} respondió el ticket ${formatFolio(ctx.folio)}\n` +
      `Asunto: ${ctx.subject}\n` +
      (author ? `Escribió: ${author}\n` : "") +
      `\n${(ctx.bodyPreview ?? "").trim()}\n\n` +
      `Abrir en el panel admin: ${url}`;

    await sendEmail({
      to: getSupportInboxEmail(),
      subject: subjectWithFolio(ctx, "Respuesta de la clínica"),
      html,
      text,
    });
  } catch (err) {
    console.error("[support.notifyClinicReply]", err);
  }
}

/** Soporte respondió → email al creador del ticket en la clínica. */
export async function notifySupportReply(ctx: SupportEmailContext): Promise<void> {
  if (!ctx.toEmail) return;
  try {
    const author = (ctx.authorName ?? "").trim();
    const url = clinicTicketUrl(ctx.ticketId);
    const attCount = ctx.attachmentCount ?? 0;
    const attLine =
      attCount > 0
        ? `📎 ${attCount} archivo${attCount === 1 ? "" : "s"} adjunto${attCount === 1 ? "" : "s"} — descárgalo${attCount === 1 ? "" : "s"} desde tu panel.`
        : "";

    const html = darkShell(`
    ${heading("Soporte respondió tu ticket")}
    ${metaLine(ctx)}
    ${paragraph(`${author ? `<strong style="color: #f5f5f7;">${escapeHtml(author)}</strong>, del equipo de soporte de DaleControl,` : "El equipo de soporte de DaleControl"} te respondió:`)}
    ${previewBlock(ctx.bodyPreview)}
    ${attLine ? paragraph(escapeHtml(attLine)) : ""}
    ${paragraph("Puedes contestar directamente desde tu panel; ahí también verás el hilo completo.")}
    ${ctaButton(url, "Ver mi ticket →")}`);

    const text =
      `Soporte respondió tu ticket ${formatFolio(ctx.folio)}\n` +
      `Asunto: ${ctx.subject}\n` +
      (author ? `Te respondió: ${author}\n` : "") +
      `\n${(ctx.bodyPreview ?? "").trim()}\n` +
      (attLine ? `\n${attLine}\n` : "") +
      `\nVer mi ticket: ${url}`;

    await sendEmail({
      to: ctx.toEmail,
      subject: subjectWithFolio(ctx, "Respuesta de soporte"),
      html,
      text,
    });
  } catch (err) {
    console.error("[support.notifySupportReply]", err);
  }
}

/** Texto corto por estado para notifyStatusChange (perspectiva de la clínica). */
const STATUS_CHANGE_COPY: Record<string, string> = {
  ABIERTO: "Tu ticket volvió a la cola de soporte. Te avisaremos en cuanto haya novedades.",
  EN_PROGRESO: "El equipo de soporte ya está trabajando en tu ticket. Te avisaremos cuando haya avances.",
  ESPERANDO_RESPUESTA: "Soporte necesita una respuesta tuya para continuar. Entra al ticket y contesta cuando puedas.",
  RESUELTO: "Marcamos tu ticket como resuelto. Si todo quedó bien, entra al ticket para cerrarlo y calificar la atención; si algo sigue fallando, responde y lo retomamos.",
  CERRADO: "Tu ticket quedó cerrado. Gracias por escribirnos; si necesitas algo más, abre un ticket nuevo cuando quieras.",
};

/** Soporte cambió el estado → email al creador del ticket en la clínica. */
export async function notifyStatusChange(ctx: SupportEmailContext): Promise<void> {
  if (!ctx.toEmail) return;
  const statusLabel = SUPPORT_STATUS_LABELS_CLINIC[ctx.status ?? ""] ?? ctx.status ?? "";
  try {
    const copy = STATUS_CHANGE_COPY[ctx.status ?? ""] ?? `El estado de tu ticket cambió a "${statusLabel}".`;
    const url = clinicTicketUrl(ctx.ticketId);

    const html = darkShell(`
    ${heading(`Tu ticket cambió a ${escapeHtml(statusLabel)}`)}
    ${metaLine(ctx)}
    ${paragraph(escapeHtml(copy))}
    ${ctaButton(url, "Ver mi ticket →")}`);

    const text =
      `Tu ticket ${formatFolio(ctx.folio)} cambió a: ${statusLabel}\n` +
      `Asunto: ${ctx.subject}\n\n` +
      `${copy}\n\n` +
      `Ver mi ticket: ${url}`;

    await sendEmail({
      to: ctx.toEmail,
      subject: subjectWithFolio(ctx, `Tu ticket cambió a ${statusLabel}`),
      html,
      text,
    });
  } catch (err) {
    console.error("[support.notifyStatusChange]", err);
  }
}
