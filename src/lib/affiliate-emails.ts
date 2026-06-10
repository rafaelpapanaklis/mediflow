/**
 * Emails automáticos al afiliado. TODOS fire-and-forget y a prueba de fallos:
 * jamás tiran (try/catch interno) y respetan las preferencias de
 * AffiliatePrefs (default true si no hay fila o la tabla aún no existe).
 *
 * HTML con el idioma visual de sendWelcomeEmail en src/lib/email.ts (dark
 * #0b0815, card #121020, marca DaleControl #a78bfa, CTA violeta). Español
 * neutro con tú. CTA → `${SITE_URL}/afiliados/inicio`.
 */

import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mediflow-pi.vercel.app";

/** Escapa texto interpolado en el HTML del email (nombres libres). */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `$1,234.50 MXN` */
function fmtMxn(n: number): string {
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
}

/**
 * Layout compartido — calca el idioma visual de sendWelcomeEmail
 * (src/lib/email.ts): dark #0b0815, card #121020 border rgba(255,255,255,0.08)
 * radius 14, marca DaleControl #a78bfa, h1 #f5f5f7, CTA gradiente
 * #8b5cf6→#7c3aed, footer soporte@mediflow.mx.
 */
function affiliateEmailHtml(opts: {
  heading: string;
  introHtml: string;
  box?: { label: string; contentHtml: string };
}): string {
  const boxHtml = opts.box
    ? `
    <div style="padding: 18px 20px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; margin: 24px 0;">
      <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #a78bfa; font-weight: 600; margin-bottom: 6px;">
        ${opts.box.label}
      </div>
      <div style="font-size: 14px; color: rgba(245,245,247,0.85); line-height: 1.5;">
        ${opts.box.contentHtml}
      </div>
    </div>
`
    : "";

  return `
<!doctype html>
<html lang="es">
<body style="font-family: system-ui, -apple-system, sans-serif; background: #0b0815; color: #f5f5f7; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #121020; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 40px 32px;">
    <div style="font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #a78bfa; margin-bottom: 20px;">
      DaleControl
    </div>
    <h1 style="font-size: 24px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 12px 0; color: #f5f5f7;">
      ${opts.heading}
    </h1>
    <p style="font-size: 15px; color: rgba(245,245,247,0.7); line-height: 1.55; margin: 0 0 24px 0;">
      ${opts.introHtml}
    </p>
${boxHtml}
    <a href="${SITE_URL}/afiliados/inicio" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 15px; margin: 8px 0 32px 0;">
      Ir a mi panel →
    </a>

    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      ¿Tienes dudas? Responde este correo o escríbenos a
      <a href="mailto:soporte@mediflow.mx" style="color: #a78bfa;">soporte@mediflow.mx</a>.
      <br /><br />
      DaleControl — Programa de afiliados 🇲🇽
    </div>
  </div>
</body>
</html>`;
}

export interface AffiliateNotifyPrefs {
  notifySignup: boolean;
  notifyConversion: boolean;
  notifyPayout: boolean;
}

/** Lee AffiliatePrefs; sin fila (o tabla inexistente) → todo true. */
export async function getAffiliateNotifyPrefs(affiliateId: string): Promise<AffiliateNotifyPrefs> {
  try {
    const row = await prisma.affiliatePrefs.findUnique({ where: { affiliateId } });
    if (!row) return { notifySignup: true, notifyConversion: true, notifyPayout: true };
    return {
      notifySignup: row.notifySignup,
      notifyConversion: row.notifyConversion,
      notifyPayout: row.notifyPayout,
    };
  } catch {
    return { notifySignup: true, notifyConversion: true, notifyPayout: true };
  }
}

/**
 * "Nueva clínica registrada con tu enlace 🎉" — aviso al afiliado cuando una
 * clínica se registra con su código. Respeta notifySignup. Jamás tira.
 */
export async function sendAffiliateNewReferralEmail(opts: {
  affiliateId: string;
  clinicName: string;
}): Promise<void> {
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: opts.affiliateId },
      select: { name: true, email: true },
    });
    if (!affiliate) return;

    const prefs = await getAffiliateNotifyPrefs(opts.affiliateId);
    if (!prefs.notifySignup) return;

    const clinicName = esc(opts.clinicName);
    const html = affiliateEmailHtml({
      heading: "¡Nueva clínica registrada! 🎉",
      introHtml: `Hola, ${esc(affiliate.name)}: la clínica <strong style="color: #f5f5f7;">${clinicName}</strong> acaba de registrarse en DaleControl con tu código de afiliado.`,
      box: {
        label: "¿Qué sigue?",
        contentHtml: `Tu comisión se genera cuando <strong style="color: #f5f5f7;">${clinicName}</strong> pague su primera factura. Te avisaremos en cuanto suceda.`,
      },
    });
    const text =
      `Hola, ${affiliate.name}:\n\n` +
      `La clínica "${opts.clinicName}" acaba de registrarse en DaleControl con tu código de afiliado.\n\n` +
      `Tu comisión se genera cuando pague su primera factura. Te avisaremos en cuanto suceda.\n\n` +
      `Tu panel: ${SITE_URL}/afiliados/inicio\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: affiliate.email,
      subject: "Nueva clínica registrada con tu enlace 🎉",
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliateNewReferralEmail:", err);
  }
}

/**
 * "¡Tu referido ya es cliente de pago! 💜" — SOLO si la comisión recién
 * creada es la PRIMERA de esa clínica (se llama justo después del create →
 * count === 1; si es mayor, return silencioso). Respeta notifyConversion.
 * Jamás tira.
 */
export async function sendAffiliateConversionEmail(opts: {
  affiliateId: string;
  clinicId: string;
  commissionMxn: number;
}): Promise<void> {
  try {
    const n = await prisma.affiliateCommission.count({ where: { clinicId: opts.clinicId } });
    if (n !== 1) return; // ya era cliente — solo celebramos la primera factura

    const affiliate = await prisma.affiliate.findUnique({
      where: { id: opts.affiliateId },
      select: { name: true, email: true },
    });
    if (!affiliate) return;

    const prefs = await getAffiliateNotifyPrefs(opts.affiliateId);
    if (!prefs.notifyConversion) return;

    const clinic = await prisma.clinic.findUnique({
      where: { id: opts.clinicId },
      select: { name: true },
    });
    const clinicName = esc(clinic?.name ?? "tu referido");
    const amount = fmtMxn(opts.commissionMxn);

    const html = affiliateEmailHtml({
      heading: "¡Tu referido ya es cliente de pago! 💜",
      introHtml: `Hola, ${esc(affiliate.name)}: <strong style="color: #f5f5f7;">${clinicName}</strong> pagó su primera factura en DaleControl.`,
      box: {
        label: "Comisión ganada",
        contentHtml: `<strong style="color: #f5f5f7;">${amount}</strong> — y seguirás ganando una comisión cada mes mientras la clínica siga activa.`,
      },
    });
    const text =
      `Hola, ${affiliate.name}:\n\n` +
      `${clinic?.name ?? "Tu referido"} pagó su primera factura en DaleControl.\n\n` +
      `Ganaste ${amount} y seguirás ganando una comisión cada mes mientras la clínica siga activa.\n\n` +
      `Tu panel: ${SITE_URL}/afiliados/inicio\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: affiliate.email,
      subject: "¡Tu referido ya es cliente de pago! 💜",
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliateConversionEmail:", err);
  }
}

/**
 * "Tu pago de comisiones está en camino 💸" — lo dispara el admin al marcar
 * las comisiones pending como paid. Respeta notifyPayout. Jamás tira.
 */
export async function sendAffiliatePayoutPaidEmail(opts: {
  affiliateId: string;
  totalMxn: number;
  count: number;
}): Promise<void> {
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: opts.affiliateId },
      select: { name: true, email: true },
    });
    if (!affiliate) return;

    const prefs = await getAffiliateNotifyPrefs(opts.affiliateId);
    if (!prefs.notifyPayout) return;

    const total = fmtMxn(opts.totalMxn);
    const unit = opts.count === 1 ? "comisión" : "comisiones";

    const html = affiliateEmailHtml({
      heading: "Tu pago está en camino 💸",
      introHtml: `Hola, ${esc(affiliate.name)}: acabamos de liquidar ${opts.count} ${unit} de tu cuenta de afiliado.`,
      box: {
        label: "Total liquidado",
        contentHtml: `<strong style="color: #f5f5f7;">${total}</strong> (${opts.count} ${unit}). Revisa que tus datos de pago estén al día en la sección <strong style="color: #f5f5f7;">Configuración</strong> de tu panel.`,
      },
    });
    const text =
      `Hola, ${affiliate.name}:\n\n` +
      `Acabamos de liquidar ${opts.count} ${unit} por un total de ${total}.\n\n` +
      `Revisa que tus datos de pago estén al día en la sección Configuración de tu panel.\n\n` +
      `Tu panel: ${SITE_URL}/afiliados/inicio\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: affiliate.email,
      subject: "Tu pago de comisiones está en camino 💸",
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliatePayoutPaidEmail:", err);
  }
}

// ── EQUIPOS DE VENDEDORES ─────────────────────────────────────────────────
// Espejos de los emails de afiliado, dirigidos al VENDEDOR (AffiliateSeller).
// Mismo idioma visual y misma garantía: jamás tiran.

/**
 * "¡Ganaste una comisión de equipo! 💜" — aviso al VENDEDOR cuando una clínica
 * que le fue atribuida paga su primera factura. SOLO si la comisión recién
 * creada es la PRIMERA de ese vendedor para esa clínica (se llama justo después
 * del create → count === 1; si es mayor, return silencioso). Jamás tira.
 */
export async function sendAffiliateSellerConversionEmail({
  sellerId,
  clinicId,
  commissionMxn,
}: {
  sellerId: string;
  clinicId: string;
  commissionMxn: number;
}): Promise<void> {
  try {
    const n = await prisma.affiliateSellerCommission.count({
      where: { sellerId, clinicId },
    });
    if (n !== 1) return; // ya era cliente — solo celebramos la primera factura

    const seller = await prisma.affiliateSeller.findUnique({
      where: { id: sellerId },
      select: { name: true, email: true },
    });
    if (!seller) return;

    const clinic = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { name: true },
    });
    const clinicName = esc(clinic?.name ?? "tu clínica referida");
    const amount = fmtMxn(commissionMxn);

    const html = affiliateEmailHtml({
      heading: "¡Ganaste una comisión de equipo! 💜",
      introHtml: `Hola, ${esc(seller.name)}: <strong style="color: #f5f5f7;">${clinicName}</strong>, una clínica que registraste, pagó su primera factura en DaleControl.`,
      box: {
        label: "Comisión ganada",
        contentHtml: `<strong style="color: #f5f5f7;">${amount}</strong> — y seguirás ganando una comisión cada mes mientras la clínica siga activa.`,
      },
    });
    const text =
      `Hola, ${seller.name}:\n\n` +
      `${clinic?.name ?? "Una clínica que registraste"} pagó su primera factura en DaleControl.\n\n` +
      `Ganaste ${amount} y seguirás ganando una comisión cada mes mientras la clínica siga activa.\n\n` +
      `Tu panel: ${SITE_URL}/afiliados/inicio\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: seller.email,
      subject: "¡Ganaste una comisión de equipo! 💜",
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliateSellerConversionEmail:", err);
  }
}

/**
 * "Tu pago de comisiones está en camino 💸" — espejo de
 * sendAffiliatePayoutPaidEmail pero dirigido al VENDEDOR. Lo dispara el admin
 * al liquidar las comisiones pending del vendedor. Jamás tira.
 */
export async function sendAffiliateSellerPayoutPaidEmail({
  sellerId,
  totalMxn,
  count,
}: {
  sellerId: string;
  totalMxn: number;
  count: number;
}): Promise<void> {
  try {
    const seller = await prisma.affiliateSeller.findUnique({
      where: { id: sellerId },
      select: { name: true, email: true },
    });
    if (!seller) return;

    const total = fmtMxn(totalMxn);
    const unit = count === 1 ? "comisión" : "comisiones";

    const html = affiliateEmailHtml({
      heading: "Tu pago está en camino 💸",
      introHtml: `Hola, ${esc(seller.name)}: acabamos de liquidar ${count} ${unit} de tu cuenta de vendedor.`,
      box: {
        label: "Total liquidado",
        contentHtml: `<strong style="color: #f5f5f7;">${total}</strong> (${count} ${unit}). Revisa que tus datos de pago estén al día en la sección <strong style="color: #f5f5f7;">Configuración</strong> de tu panel.`,
      },
    });
    const text =
      `Hola, ${seller.name}:\n\n` +
      `Acabamos de liquidar ${count} ${unit} por un total de ${total}.\n\n` +
      `Revisa que tus datos de pago estén al día en la sección Configuración de tu panel.\n\n` +
      `Tu panel: ${SITE_URL}/afiliados/inicio\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: seller.email,
      subject: "Tu pago de comisiones está en camino 💸",
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliateSellerPayoutPaidEmail:", err);
  }
}
