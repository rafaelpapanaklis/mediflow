import { NextResponse } from "next/server";
import {
  ingestInboundMail,
  verifyInboundSecret,
  inboundSecret,
  type RealtyInboundMail,
} from "@/lib/realty/inbound-mail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ⭐ CAPTURA DE PROSPECTOS DE PORTALES POR CORREO.
 *
 * Cada cuenta tiene un buzón único (leads+<accountId>@…) que pone como
 * correo de contacto en Inmuebles24, Lamudi, Vivanuncios, Mercado Libre,
 * Casas y Terrenos o Propiedades.com — o al que le arma una regla de
 * reenvío desde su Gmail. El correo llega aquí, se parsea, se crea el
 * prospecto, se asigna solo y se deja preparado el saludo por WhatsApp.
 *
 * ── QUIÉN LLAMA A ESTA RUTA ────────────────────────────────────────────
 * El repo ya usa Postmark Inbound para el dental
 * (/api/webhooks/postmark/inbound, que resuelve la clínica por
 * Clinic.postmarkInboundEmail y por lo tanto NUNCA encontraría una cuenta
 * de inmuebles). Este vertical necesita su PROPIO stream de Postmark
 * apuntado aquí; el payload nativo de Postmark se acepta tal cual.
 *
 * También acepta un payload plano (messageId/from/to/subject/text) para
 * cualquier otro proveedor o para probar con curl.
 *
 * ── SEGURIDAD ──────────────────────────────────────────────────────────
 * Secret compartido en el header Authorization (REALTY_INBOUND_SECRET, con
 * cascada a POSTMARK_INBOUND_SECRET). Sin secret configurado en PRODUCCIÓN
 * el endpoint responde 503 en vez de aceptar cualquier cosa: un webhook
 * abierto deja que cualquiera meta prospectos falsos en la cuenta que
 * quiera, porque el accountId viaja en la dirección del buzón.
 *
 * ── CÓDIGOS ────────────────────────────────────────────────────────────
 * 200 para todo lo que ya no tiene remedio (buzón desconocido, cuenta
 * inactiva, duplicado): si devolviéramos 5xx, el proveedor reintentaría en
 * bucle el mismo correo que nunca va a funcionar. 401 firma mala, 503 sin
 * configurar, 500 solo si algo transitorio falló y SÍ vale reintentar.
 */

interface PostmarkLike {
  MessageID?: string;
  From?: string;
  FromName?: string;
  To?: string;
  Cc?: string;
  ToFull?: { Email?: string }[];
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  MailboxHash?: string;
  Date?: string;
  Headers?: { Name?: string; Value?: string }[];
}

interface PlainLike {
  messageId?: string;
  from?: string;
  fromName?: string;
  to?: string | string[];
  recipients?: string[];
  subject?: string;
  text?: string;
  textBody?: string;
  html?: string;
  htmlBody?: string;
  mailboxHash?: string;
  receivedAt?: string;
}

const FORWARD_HEADERS = ["delivered-to", "x-forwarded-to", "x-original-to", "envelope-to"];

/** Normaliza los dos formatos a RealtyInboundMail. */
function normalize(raw: PostmarkLike & PlainLike): RealtyInboundMail | null {
  const messageId = String(raw.MessageID ?? raw.messageId ?? "").trim();
  if (!messageId) return null;

  const recipients: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) recipients.push(v.trim());
    else if (Array.isArray(v)) v.forEach(push);
  };
  push(raw.To);
  push(raw.to);
  push(raw.recipients);
  push(raw.Cc);
  for (const t of raw.ToFull ?? []) push(t?.Email);
  // 🔴 Con una REGLA DE REENVÍO el To original es el correo del cliente y el
  // buzón solo aparece en estas cabeceras. Sin esto, el reenvío —que es como
  // la mitad de los clientes lo va a configurar— no cae en ninguna cuenta.
  for (const h of raw.Headers ?? []) {
    if (h?.Name && FORWARD_HEADERS.includes(h.Name.toLowerCase())) push(h.Value);
  }

  return {
    messageId,
    from: String(raw.From ?? raw.from ?? ""),
    fromName: raw.FromName ?? raw.fromName ?? null,
    recipients,
    mailboxHash: raw.MailboxHash ?? raw.mailboxHash ?? null,
    subject: String(raw.Subject ?? raw.subject ?? ""),
    textBody: String(raw.TextBody ?? raw.textBody ?? raw.text ?? raw.StrippedTextReply ?? ""),
    htmlBody: raw.HtmlBody ?? raw.htmlBody ?? raw.html ?? null,
    receivedAt: raw.Date ?? raw.receivedAt ?? null,
  };
}

export async function POST(req: Request) {
  if (!inboundSecret() && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Captura por correo sin configurar (falta REALTY_INBOUND_SECRET)" },
      { status: 503 },
    );
  }
  if (!verifyInboundSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "invalid_secret" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as (PostmarkLike & PlainLike) | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: true, ignored: "payload_invalido" });
  }

  const mail = normalize(body);
  if (!mail) return NextResponse.json({ ok: true, ignored: "sin_message_id" });

  try {
    const result = await ingestInboundMail(mail);
    if (result.status !== "CREADO") {
      // 200 a propósito: reintentar no lo va a arreglar.
      return NextResponse.json({ ok: true, ignored: result.status, leadId: result.leadId });
    }
    return NextResponse.json({
      ok: true,
      leadId: result.leadId,
      contactId: result.contactId,
      portal: result.portal,
      assignedUserId: result.assignedUserId,
      propertyLinked: result.propertyLinked,
      whatsapp: result.whatsapp,
    });
  } catch (err) {
    // 500 SÍ: aquí falló algo transitorio (base caída) y el correo todavía
    // se puede salvar en el reintento del proveedor.
    console.error("[realty inbound-mail] fallo al procesar", mail.messageId, err);
    return NextResponse.json({ error: "error_transitorio" }, { status: 500 });
  }
}

/** Handshake de verificación de algunos proveedores. */
export async function GET() {
  return NextResponse.json({ ok: true, service: "realty-inbound-mail" });
}
