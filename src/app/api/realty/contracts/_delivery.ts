import "server-only";

// ═══════════════════════════════════════════════════════════════════════
// CÓMO SALE LA LIGA DE FIRMA — y cómo se dice la VERDAD de si salió.
//
// Dos canales, ninguno inventado desde cero:
//   · WhatsApp → sendRealtyWhatsApp (T6). Es el ÚNICO camino del vertical:
//     ahí viven el cupo, la ventana de 24 h y el registro en el hilo. Aquí
//     no se llama a Meta por fuera ni de casualidad.
//   · Correo   → sendEmail (src/lib/email.ts). Devuelve `delivered:false`
//     cuando no hay RESEND_API_KEY, y eso se propaga hasta la pantalla.
//
// 🔴 SE MANDA TEXTO LIBRE, NO PLANTILLA. Las plantillas de WhatsApp del
// vertical viven en whatsapp-core.ts (REALTY_WA_TEMPLATES) y esa terminal
// no es esta: agregar `contractSign` ahí es de quien manda ese archivo. La
// consecuencia se dice tal cual y no se disimula: si la ventana de 24 h con
// esa persona está cerrada, WhatsApp NO entrega y la pantalla lo enseña con
// el motivo que devuelve T6, con la liga a la vista para copiarla a mano.
// Queda anotado en ORQUESTA.md como el único pendiente del canal.
//
// ⚠️ NADA DE ESTO PUEDE TUMBAR NADA. Un contrato ya quedó sellado y sus
// ligas emitidas ANTES de llegar aquí: que un correo rebote no puede
// deshacer eso. Por eso todo devuelve un resultado y nada lanza.
// ═══════════════════════════════════════════════════════════════════════

import { sendEmail } from "@/lib/email";
import { isRealtyWaSendOk, sendRealtyWhatsApp } from "@/lib/realty/whatsapp";
import { markLinkSent, type IssuedLink } from "@/lib/realty/contracts";

export type DeliveryChannel = "whatsapp" | "correo" | "copiada";

export interface DeliveryOutcome {
  partyId: string;
  partyName: string;
  channel: DeliveryChannel;
  /** La verdad, no la intención: false = no salió. */
  delivered: boolean;
  /** Por qué, en español, listo para pintarse. */
  detail: string;
  /** La liga EN CLARO. Es la única vez que existe: se enseña para copiar. */
  url: string;
  expiresAt: string;
}

export interface PartyContact {
  id: string;
  email: string | null;
  phone: string | null;
  contactId?: string | null;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Primer nombre, para que el mensaje no empiece con un nombre completo. */
function firstName(name: string): string {
  return String(name ?? "").trim().split(/\s+/)[0] || "hola";
}

function waBody(args: {
  partyName: string;
  accountName: string;
  title: string;
  folio: string;
  url: string;
  days: number;
}): string {
  return (
    `Hola ${firstName(args.partyName)}, te comparto el ${args.title} (folio ${args.folio}) ` +
    `de ${args.accountName} para que lo leas y lo firmes desde tu celular:\n\n${args.url}\n\n` +
    `La liga es personal y vence en ${args.days} días. ` +
    `Cualquier duda, respóndeme por aquí mismo.`
  );
}

function mailHtml(args: {
  partyName: string;
  accountName: string;
  title: string;
  folio: string;
  url: string;
  days: number;
}): string {
  const safeUrl = escapeHtml(args.url);
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1c1c1c">
  <p>Hola ${escapeHtml(firstName(args.partyName))}:</p>
  <p>${escapeHtml(args.accountName)} te comparte el <strong>${escapeHtml(args.title)}</strong>
     (folio ${escapeHtml(args.folio)}) para que lo leas completo y lo firmes desde tu celular
     o tu computadora.</p>
  <p><a href="${safeUrl}"
        style="display:inline-block;padding:12px 20px;border-radius:10px;background:#14532d;color:#fff;text-decoration:none;font-weight:600">
     Leer y firmar el documento</a></p>
  <p style="font-size:13px;color:#555">Si el botón no abre, copia esta dirección en tu navegador:<br>
     <span style="word-break:break-all">${safeUrl}</span></p>
  <p style="font-size:13px;color:#555">La liga es personal y vence en ${args.days} días.
     No la reenvíes: quien la tenga puede firmar en tu nombre.</p>
</div>`;
}

/**
 * Manda UNA liga por el canal que pidió el asesor.
 *
 * "copiada" no es un no-canal: deja constancia de que la liga salió a mano
 * (por donde sea) para que el tablero no diga "sin enviar" cuando sí se
 * mandó por otro lado.
 */
export async function deliverSignatureLink(args: {
  accountId: string;
  accountName: string;
  contractId: string;
  title: string;
  folio: string;
  link: IssuedLink;
  contact: PartyContact | undefined;
  channel: DeliveryChannel;
  linkDays: number;
}): Promise<DeliveryOutcome> {
  const base = {
    partyId: args.link.partyId,
    partyName: args.link.partyName,
    channel: args.channel,
    url: args.link.url,
    expiresAt: args.link.expiresAt,
  };

  if (args.channel === "copiada") {
    await markLinkSent(args.accountId, args.contractId, args.link.partyId, "copiada");
    return { ...base, delivered: true, detail: "Liga lista para copiar." };
  }

  if (args.channel === "whatsapp") {
    const phone = args.contact?.phone ?? null;
    if (!phone) {
      return { ...base, delivered: false, detail: "Esta persona no tiene teléfono capturado." };
    }
    const result = await sendRealtyWhatsApp({
      accountId: args.accountId,
      phone,
      contactId: args.contact?.contactId ?? null,
      // Sin plantilla: solo entra si la ventana de 24 h está abierta.
      kind: null,
      body: waBody({
        partyName: args.link.partyName,
        accountName: args.accountName,
        title: args.title,
        folio: args.folio,
        url: args.link.url,
        days: args.linkDays,
      }),
    });
    if (isRealtyWaSendOk(result)) {
      await markLinkSent(args.accountId, args.contractId, args.link.partyId, "whatsapp");
      return { ...base, delivered: true, detail: "Enviado por WhatsApp." };
    }
    return { ...base, delivered: false, detail: result.error };
  }

  const email = args.contact?.email ?? null;
  if (!email) {
    return { ...base, delivered: false, detail: "Esta persona no tiene correo capturado." };
  }
  const { delivered } = await sendEmail({
    to: email,
    subject: `${args.title} · folio ${args.folio} — para firmar`,
    html: mailHtml({
      partyName: args.link.partyName,
      accountName: args.accountName,
      title: args.title,
      folio: args.folio,
      url: args.link.url,
      days: args.linkDays,
    }),
    text:
      `Hola ${firstName(args.link.partyName)}: ${args.accountName} te comparte el ` +
      `${args.title} (folio ${args.folio}) para firmar.\n\n${args.link.url}\n\n` +
      `La liga es personal y vence en ${args.linkDays} días.`,
  });
  if (delivered) {
    await markLinkSent(args.accountId, args.contractId, args.link.partyId, "correo");
    return { ...base, delivered: true, detail: "Enviado por correo." };
  }
  return {
    ...base,
    delivered: false,
    detail: "El correo no salió (falta configurar el proveedor de correo). Copia la liga y mándala tú.",
  };
}

/**
 * El ACUSE: cuando firman todas las partes, cada una recibe constancia.
 *
 * Va con la huella del documento dentro, que es lo que convierte el acuse en
 * prueba: quien lo reciba puede volver a pedir el PDF y comprobar que el
 * sha256 sigue siendo el mismo.
 *
 * Best-effort de principio a fin y en SERIE: son dos o tres destinatarios,
 * no un envío masivo, y así un rebote no arrastra a los demás. Se registra
 * lo que pasó y se sigue: el contrato YA está firmado con o sin acuse.
 */
export async function sendCompletionReceipts(args: {
  accountId: string;
  accountName: string;
  title: string;
  folio: string;
  documentHash: string;
  parties: Array<{ name: string; email: string | null; phone: string | null; contactId: string | null }>;
}): Promise<number> {
  let sent = 0;
  for (const p of args.parties) {
    const linea =
      `Listo: el ${args.title} (folio ${args.folio}) quedó firmado por todas las partes. ` +
      `Huella del documento: ${args.documentHash.slice(0, 12)}…`;
    try {
      if (p.email) {
        const { delivered } = await sendEmail({
          to: p.email,
          subject: `Firmado · ${args.title} (folio ${args.folio})`,
          html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.6;color:#1c1c1c">
  <p>Hola ${escapeHtml(firstName(p.name))}:</p>
  <p>El <strong>${escapeHtml(args.title)}</strong> (folio ${escapeHtml(args.folio)}) de
     ${escapeHtml(args.accountName)} quedó <strong>firmado por todas las partes</strong>.</p>
  <p style="font-size:13px;color:#555">Huella del documento (SHA-256):<br>
     <span style="word-break:break-all;font-family:ui-monospace,Menlo,monospace">${escapeHtml(args.documentHash)}</span></p>
  <p style="font-size:13px;color:#555">Guarda este correo: la huella es lo que permite comprobar,
     cuando haga falta, que el documento no cambió después de firmarse.</p>
</div>`,
          text: `${linea}\n\nHuella completa: ${args.documentHash}`,
        });
        if (delivered) sent += 1;
      }
      if (p.phone) {
        const result = await sendRealtyWhatsApp({
          accountId: args.accountId,
          phone: p.phone,
          contactId: p.contactId,
          kind: null,
          body: linea,
        });
        if (isRealtyWaSendOk(result)) sent += 1;
      }
    } catch (e) {
      console.warn("[realty/contracts] acuse no entregado:", (e as Error).message);
    }
  }
  return sent;
}
