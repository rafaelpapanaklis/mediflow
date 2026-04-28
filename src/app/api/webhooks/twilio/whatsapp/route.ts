import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  parseInbound,
  stripWhatsappPrefix,
  verifyTwilioSignature,
} from "@/lib/integrations/twilio-conversations";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/twilio/whatsapp
 * Twilio Conversations envía cada mensaje WhatsApp inbound como
 * application/x-www-form-urlencoded. Resolución de clínica:
 *  1. El "To" del payload es "whatsapp:<número>" — buscamos clinic.twilioWhatsappNumber.
 *  2. Si no hay match, respondemos 200 (Twilio reintentaría innecesariamente).
 */
export async function POST(req: NextRequest) {
  try {
    const url = req.url;
    const signature = req.headers.get("X-Twilio-Signature");
    const text = await req.text();
    const params = new URLSearchParams(text);
    const paramsRecord: Record<string, string> = {};
    params.forEach((v, k) => { paramsRecord[k] = v; });

    const inbound = parseInbound(params);
    const toNumber = stripWhatsappPrefix(inbound.To);
    const fromNumber = stripWhatsappPrefix(inbound.From);

    const clinic = await prisma.clinic.findFirst({
      where: { twilioWhatsappNumber: toNumber },
      select: {
        id: true,
        twilioAuthToken: true,
      },
    });
    if (!clinic) {
      // No hay clínica con ese número. Respondemos 200 para que Twilio no reintente.
      return NextResponse.json({ ok: true, ignored: "clinic_not_found" });
    }

    const valid = await verifyTwilioSignature(clinic.twilioAuthToken, url, paramsRecord, signature);
    if (!valid) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    // Match patient por phone (igual o termina con últimos 10).
    const last10 = fromNumber.replace(/\D/g, "").slice(-10);
    const patient = last10
      ? await prisma.patient.findFirst({
          where: {
            clinicId: clinic.id,
            phone: { contains: last10 },
          },
          select: { id: true },
        })
      : null;

    const now = new Date();
    const externalThreadKey = inbound.ConversationSid ?? fromNumber;

    // Busca thread existente por externalId; si no, crea uno nuevo.
    let thread = await prisma.inboxThread.findFirst({
      where: {
        clinicId: clinic.id,
        channel: "WHATSAPP",
        externalId: externalThreadKey,
      },
      select: { id: true },
    });

    if (!thread) {
      const created = await prisma.inboxThread.create({
        data: {
          clinicId: clinic.id,
          channel: "WHATSAPP",
          externalId: externalThreadKey,
          patientId: patient?.id ?? null,
          subject: inbound.ProfileName
            ? `WhatsApp · ${inbound.ProfileName}`
            : `WhatsApp · ${fromNumber}`,
          status: "UNREAD",
          lastMessageAt: now,
        },
        select: { id: true },
      });
      thread = created;
    } else {
      await prisma.inboxThread.update({
        where: { id: thread.id },
        data: { status: "UNREAD", lastMessageAt: now },
      });
    }

    await prisma.inboxMessage.create({
      data: {
        threadId: thread.id,
        direction: "IN",
        body: inbound.Body,
        externalId: inbound.MessageSid,
        sentAt: now,
      },
    });

    return NextResponse.json({ ok: true, threadId: thread.id });
  } catch (err) {
    console.error("[POST /api/webhooks/twilio/whatsapp]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
