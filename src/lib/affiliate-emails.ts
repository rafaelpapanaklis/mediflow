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
import { getPayoutConfig } from "@/lib/affiliates/payout";
import { getPublicOffer } from "@/lib/affiliates/public-offer";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

/**
 * A dónde llega el aviso de "nuevo afiliado esperando aprobación".
 * `ADMIN_NOTIFY_EMAIL` es opcional: sin ella el aviso cae en el buzón general.
 */
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL?.trim() || "hola@dalecontrol.com";

/** Contacto público del programa (el mismo que publican /terminos-afiliados). */
const PROGRAM_EMAIL = "hola@dalecontrol.com";

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
 * #8b5cf6→#7c3aed, footer soporte@dalecontrol.com.
 */
function affiliateEmailHtml(opts: {
  heading: string;
  introHtml: string;
  box?: { label: string; contentHtml: string };
  /** Segunda caja, bajo la primera (la aprobación lleva datos + montos). */
  extraBox?: { label: string; contentHtml: string };
  /**
   * Botón del pie. Omitirlo conserva el CTA histórico ("Ir a mi panel →"), así
   * que los 5 correos que ya existían salen byte a byte igual que antes.
   * `null` = sin botón (el rechazo no tiene a dónde mandar a nadie).
   */
  cta?: { href: string; label: string } | null;
}): string {
  const cta =
    opts.cta === undefined
      ? { href: `${SITE_URL}/afiliados/inicio`, label: "Ir a mi panel →" }
      : opts.cta;

  const ctaHtml = cta
    ? `
    <a href="${cta.href}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; font-weight: 600; text-decoration: none; border-radius: 10px; font-size: 15px; margin: 8px 0 32px 0;">
      ${cta.label}
    </a>`
    : // Sin botón, el <hr> se pegaría al texto: se conserva el mismo aire.
      `<div style="height: 8px;"></div>`;

  // Lista explícita en vez de .filter(Boolean): TS no estrecha el tipo con
  // filter(Boolean) y el repo no está en strict, pero tampoco hace falta el
  // cast si se construye a mano.
  const boxes: { label: string; contentHtml: string }[] = [];
  if (opts.box) boxes.push(opts.box);
  if (opts.extraBox) boxes.push(opts.extraBox);

  const boxHtml = boxes
    .map(
      (b) => `
    <div style="padding: 18px 20px; background: rgba(124,58,237,0.1); border: 1px solid rgba(124,58,237,0.3); border-radius: 10px; margin: 24px 0;">
      <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #a78bfa; font-weight: 600; margin-bottom: 6px;">
        ${b.label}
      </div>
      <div style="font-size: 14px; color: rgba(245,245,247,0.85); line-height: 1.5;">
        ${b.contentHtml}
      </div>
    </div>
`,
    )
    .join("");

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
${boxHtml}${ctaHtml}

    <hr style="border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 28px 0;" />

    <div style="font-size: 11px; color: rgba(245,245,247,0.4); line-height: 1.5;">
      ¿Tienes dudas? Responde este correo o escríbenos a
      <a href="mailto:soporte@dalecontrol.com" style="color: #a78bfa;">soporte@dalecontrol.com</a>.
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

// ── ALTA DE AFILIADOS ─────────────────────────────────────────────────────
// Los 4 correos del ciclo de vida de una solicitud: aviso al admin, acuse al
// solicitante, aprobación y rechazo.
//
// A diferencia de los de arriba, estos NO consultan AffiliatePrefs: esas
// preferencias (notifySignup / notifyConversion / notifyPayout) son para la
// actividad de referidos. Un acuse de solicitud o un aviso de aprobación son
// transaccionales —el afiliado no puede darse de baja de saber si lo
// aprobamos— y además el afiliado ni siquiera tiene panel para configurarlas
// hasta que se le aprueba.
//
// SUSPENDED no manda correo a propósito: es una acción que el admin toma
// sabiendo lo que hace, y avisarla por correo automático invita a una
// discusión que conviene tener a mano.

/** Etiqueta legible del método de pago declarado en el registro. */
const PAYOUT_METHOD_LABELS: Record<string, string> = {
  SPEI: "Transferencia SPEI",
  PAYPAL: "PayPal",
  OTHER: "Otro (lo describió al registrarse)",
};

/** "segundo cobro" a partir del número de la config. Nunca se escribe a mano. */
function cobroOrdinal(n: number): string {
  if (n === 1) return "primer cobro";
  if (n === 2) return "segundo cobro";
  if (n === 3) return "tercer cobro";
  return `cobro número ${n}`;
}

/**
 * "Nuevo afiliado esperando aprobación" — aviso a la casa, no al afiliado.
 * Destinatario: ADMIN_NOTIFY_EMAIL, con fallback a hola@dalecontrol.com.
 * Jamás tira.
 */
export async function sendAffiliateApplicationAdminEmail(opts: {
  affiliateId: string;
  name: string;
  email: string;
  payoutMethod: string | null;
}): Promise<void> {
  try {
    // Cuántas solicitudes hay en cola, para que el aviso diga si se está
    // acumulando trabajo. Si el count falla, el correo sale igual sin ese dato.
    let pending: number | null = null;
    try {
      pending = await prisma.affiliate.count({ where: { status: "PENDING" } });
    } catch {
      pending = null;
    }

    let fecha = "";
    try {
      fecha = new Date().toLocaleString("es-MX", {
        timeZone: "America/Mexico_City",
        dateStyle: "long",
        timeStyle: "short",
      });
    } catch {
      fecha = new Date().toISOString();
    }

    const metodo = opts.payoutMethod
      ? PAYOUT_METHOD_LABELS[opts.payoutMethod] ?? opts.payoutMethod
      : "Sin definir (lo elegirá después)";

    const fichaUrl = `${SITE_URL}/admin/affiliates/${opts.affiliateId}`;
    const colaHtml =
      pending === null
        ? ""
        : `<br /><br />En total hay <strong style="color: #f5f5f7;">${pending}</strong> ${
            pending === 1 ? "solicitud pendiente" : "solicitudes pendientes"
          } de revisión.`;

    const html = affiliateEmailHtml({
      heading: "Nuevo afiliado esperando aprobación",
      introHtml: `<strong style="color: #f5f5f7;">${esc(
        opts.name,
      )}</strong> acaba de solicitar entrar al programa de afiliados.`,
      box: {
        label: "Datos de la solicitud",
        contentHtml:
          `<strong style="color: #f5f5f7;">Nombre:</strong> ${esc(opts.name)}<br />` +
          `<strong style="color: #f5f5f7;">Correo:</strong> ${esc(opts.email)}<br />` +
          `<strong style="color: #f5f5f7;">Cómo quiere cobrar:</strong> ${esc(metodo)}<br />` +
          `<strong style="color: #f5f5f7;">Fecha:</strong> ${esc(fecha)}` +
          colaHtml,
      },
      cta: { href: fichaUrl, label: "Revisar la solicitud →" },
    });

    const text =
      `${opts.name} acaba de solicitar entrar al programa de afiliados.\n\n` +
      `Nombre: ${opts.name}\n` +
      `Correo: ${opts.email}\n` +
      `Cómo quiere cobrar: ${metodo}\n` +
      `Fecha: ${fecha}\n` +
      (pending === null
        ? ""
        : `\nEn total hay ${pending} ${
            pending === 1 ? "solicitud pendiente" : "solicitudes pendientes"
          } de revisión.\n`) +
      `\nRevisar la solicitud: ${fichaUrl}\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: `Nuevo afiliado esperando aprobación: ${opts.name}`,
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliateApplicationAdminEmail:", err);
  }
}

/**
 * "Recibimos tu solicitud" — acuse al solicitante en el mismo registro, para
 * que no quede en silencio. Nada de plazos que no vamos a cumplir. Jamás tira.
 */
export async function sendAffiliateApplicationReceivedEmail(opts: {
  name: string;
  email: string;
}): Promise<void> {
  try {
    const html = affiliateEmailHtml({
      heading: "Recibimos tu solicitud ✅",
      introHtml: `Hola, ${esc(
        opts.name,
      )}: tu solicitud para entrar al programa de afiliados de DaleControl ya está en nuestra bandeja.`,
      box: {
        label: "¿Qué sigue?",
        contentHtml:
          `Revisamos <strong style="color: #f5f5f7;">a mano</strong> cada solicitud, así que no es automático. ` +
          `Te escribimos a este mismo correo en los próximos días hábiles con la respuesta: si te aprobamos, ` +
          `en ese correo van tu enlace de referido y tu código para empezar.<br /><br />` +
          `Mientras tanto puedes leer los ` +
          `<a href="${SITE_URL}/terminos-afiliados" style="color: #a78bfa;">términos del programa</a>.`,
      },
      cta: { href: `${SITE_URL}/afiliados`, label: "Conocer el programa →" },
    });

    const text =
      `Hola, ${opts.name}:\n\n` +
      `Tu solicitud para entrar al programa de afiliados de DaleControl ya está en nuestra bandeja.\n\n` +
      `Revisamos a mano cada solicitud, así que no es automático. Te escribimos a este mismo correo ` +
      `en los próximos días hábiles con la respuesta: si te aprobamos, en ese correo van tu enlace ` +
      `de referido y tu código para empezar.\n\n` +
      `Términos del programa: ${SITE_URL}/terminos-afiliados\n` +
      `El programa: ${SITE_URL}/afiliados\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: opts.email,
      subject: "Recibimos tu solicitud de afiliado ✅",
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliateApplicationReceivedEmail:", err);
  }
}

/**
 * "Tu cuenta de afiliado está aprobada 🎉" — el correo que decide si el
 * afiliado empieza a vender o nunca vuelve. Accionable: su enlace, su código y
 * lo que gana, con los montos EN VIVO de affiliate_payout_config.
 *
 * Los montos SÓLO se incluyen si la config existe y el programa está en modo
 * "fixed". Si la tabla no está aplicada, `getPayoutConfig()` devuelve null y
 * `getPublicOffer()` cae a los defaults del motor: publicar esos números en un
 * correo sería prometer montos que quizá no se pagan. En modo "pct" se paga un
 * % del nivel, así que los fijos tampoco aplican. En ambos casos el correo sale
 * igual —enlace y código incluidos— y remite a /afiliados para los montos.
 *
 * Jamás tira.
 */
export async function sendAffiliateApprovedEmail(opts: { affiliateId: string }): Promise<void> {
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: opts.affiliateId },
      select: { name: true, email: true, slug: true, referralCode: true },
    });
    if (!affiliate) return;

    const [cfg, offer] = await Promise.all([
      getPayoutConfig().catch(() => null),
      getPublicOffer(),
    ]);

    const linkUrl = `${SITE_URL}/socio/${affiliate.slug}`;
    const code = esc(affiliate.referralCode);

    // Montos por plan, sólo cuando son de verdad los que paga el motor.
    const showAmounts = cfg !== null && cfg.defaultMode === "fixed";
    const planRows = showAmounts
      ? offer.plans.filter((p) => p.recurringMxn > 0 || p.oneTimeMxn > 0)
      : [];

    // Con arranque en 1 no hay mes promocional: la explicación se contradiría.
    const hayMesPromocional = offer.startAtInvoiceNo > 1;
    const arranqueTexto = hayMesPromocional
      ? `de la clínica, porque su primer mes entra con precio promocional.`
      : `de la clínica.`;
    const arranqueHtml =
      `La comisión arranca en el <strong style="color: #f5f5f7;">${cobroOrdinal(
        offer.startAtInvoiceNo,
      )}</strong> ${arranqueTexto}`;

    const amountsContentHtml =
      planRows.length > 0
        ? `${planRows
            .map((p) => {
              const partes: string[] = [];
              if (p.recurringMxn > 0) {
                partes.push(
                  `<strong style="color: #f5f5f7;">${fmtMxn(p.recurringMxn)}</strong> al mes`,
                );
              }
              if (p.oneTimeMxn > 0) {
                partes.push(
                  `<strong style="color: #f5f5f7;">${fmtMxn(p.oneTimeMxn)}</strong> de un solo pago`,
                );
              }
              return `Plan ${esc(p.label)}: ${partes.join(" o ")}`;
            })
            .join("<br />")}<br /><br />` +
          `Tú eliges la modalidad desde tu panel; se fija por clínica en el momento del alta. ` +
          arranqueHtml
        : `Consulta los montos vigentes en ` +
          `<a href="${SITE_URL}/afiliados" style="color: #a78bfa;">${SITE_URL}/afiliados</a>. ` +
          arranqueHtml;

    const html = affiliateEmailHtml({
      heading: "¡Tu cuenta de afiliado está aprobada! 🎉",
      introHtml:
        `Hola, ${esc(affiliate.name)}: ya eres afiliado de DaleControl. ` +
        `Desde ahora, cada clínica que se registre con tu enlace o con tu código queda ligada a ti.`,
      box: {
        label: "Tus datos para empezar",
        contentHtml:
          `<strong style="color: #f5f5f7;">Tu enlace:</strong><br />` +
          `<a href="${linkUrl}" style="color: #a78bfa; word-break: break-all;">${linkUrl}</a><br /><br />` +
          `<strong style="color: #f5f5f7;">Tu código de referido:</strong> ` +
          `<span style="font-family: ui-monospace, monospace; color: #f5f5f7; letter-spacing: 0.04em;">${code}</span><br /><br />` +
          `En tu panel puedes crear enlaces por campaña para saber qué canal te funciona, ` +
          `y descargar tu estado de cuenta cuando quieras.`,
      },
      extraBox: { label: "Lo que ganas por cada clínica", contentHtml: amountsContentHtml },
      cta: { href: `${SITE_URL}/afiliados/login`, label: "Entrar a mi panel →" },
    });

    const amountsText =
      planRows.length > 0
        ? planRows
            .map((p) => {
              const partes: string[] = [];
              if (p.recurringMxn > 0) partes.push(`${fmtMxn(p.recurringMxn)} al mes`);
              if (p.oneTimeMxn > 0) partes.push(`${fmtMxn(p.oneTimeMxn)} de un solo pago`);
              return `  - Plan ${p.label}: ${partes.join(" o ")}`;
            })
            .join("\n")
        : `  Consulta los montos vigentes en ${SITE_URL}/afiliados`;

    const text =
      `Hola, ${affiliate.name}:\n\n` +
      `Ya eres afiliado de DaleControl. Desde ahora, cada clínica que se registre con tu enlace ` +
      `o con tu código queda ligada a ti.\n\n` +
      `Tu enlace: ${linkUrl}\n` +
      `Tu código de referido: ${affiliate.referralCode}\n\n` +
      `Lo que ganas por cada clínica:\n${amountsText}\n\n` +
      `La comisión arranca en el ${cobroOrdinal(offer.startAtInvoiceNo)} ${arranqueTexto}\n\n` +
      `Entra a tu panel: ${SITE_URL}/afiliados/login\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: affiliate.email,
      subject: "¡Tu cuenta de afiliado está aprobada! 🎉",
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliateApprovedEmail:", err);
  }
}

/**
 * "No pudimos aprobar tu solicitud" — corto y respetuoso. El modelo Affiliate
 * no guarda un motivo, así que el correo no inventa uno: deja un contacto real
 * para quien quiera preguntar. Sin botón (no hay a dónde mandarlo).
 * Jamás tira.
 */
export async function sendAffiliateRejectedEmail(opts: { affiliateId: string }): Promise<void> {
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: opts.affiliateId },
      select: { name: true, email: true },
    });
    if (!affiliate) return;

    const html = affiliateEmailHtml({
      heading: "Sobre tu solicitud de afiliado",
      introHtml: `Hola, ${esc(
        affiliate.name,
      )}: revisamos tu solicitud para el programa de afiliados de DaleControl y por ahora no pudimos aprobarla.`,
      box: {
        label: "Si quieres saber más",
        contentHtml:
          `No es una decisión definitiva sobre ti ni sobre tu trabajo. Si crees que hay algo que ` +
          `deberíamos tomar en cuenta, escríbenos a ` +
          `<a href="mailto:${PROGRAM_EMAIL}" style="color: #a78bfa;">${PROGRAM_EMAIL}</a> ` +
          `y lo revisamos con gusto.<br /><br />` +
          `Gracias por tu interés en DaleControl.`,
      },
      cta: null,
    });

    const text =
      `Hola, ${affiliate.name}:\n\n` +
      `Revisamos tu solicitud para el programa de afiliados de DaleControl y por ahora no pudimos ` +
      `aprobarla.\n\n` +
      `No es una decisión definitiva sobre ti ni sobre tu trabajo. Si crees que hay algo que ` +
      `deberíamos tomar en cuenta, escríbenos a ${PROGRAM_EMAIL} y lo revisamos con gusto.\n\n` +
      `Gracias por tu interés en DaleControl.\n\n` +
      `DaleControl — Programa de afiliados`;

    await sendEmail({
      to: affiliate.email,
      subject: "Sobre tu solicitud de afiliado",
      html,
      text,
    });
  } catch (err) {
    console.error("[affiliate-emails] sendAffiliateRejectedEmail:", err);
  }
}
