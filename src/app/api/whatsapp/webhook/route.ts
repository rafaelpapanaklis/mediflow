import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHmac } from "crypto";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { runBotTurn } from "@/lib/whatsapp/bot/engine";
import { isAffirmative, isNegative, isCancelWord } from "@/lib/whatsapp/bot/booking-helpers";
import type { BotHistoryItem } from "@/lib/whatsapp/bot/types";
import { Prisma } from "@prisma/client";

// GET — webhook verification by Meta
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN ?? "mediflow_webhook_2026";

  if (mode === "subscribe" && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// POST — incoming messages from Meta
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Verify X-Hub-Signature-256 from Meta (REQUIRED — sin APP_SECRET configurado, rechazar).
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      console.error("[whatsapp/webhook] WHATSAPP_APP_SECRET no configurado — rechazando request");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }
    const signature = req.headers.get("x-hub-signature-256");
    if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 403 });
    const expectedSig = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
    if (signature !== expectedSig) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const body = JSON.parse(rawBody);

    // Extract message from WhatsApp webhook payload
    const entry    = body?.entry?.[0];
    const changes  = entry?.changes?.[0];
    const value    = changes?.value;
    const messages = value?.messages;

    if (!messages?.length) return NextResponse.json({ ok: true });

    const msg     = messages[0];
    const from    = msg.from;                       // teléfono del paciente (formato internacional)
    const rawText = msg.text?.body?.trim() ?? "";   // texto original (Inbox + bot)
    const text    = rawText.toLowerCase();          // para detectar confirmar/cancelar

    if (!from || !rawText) return NextResponse.json({ ok: true });

    // Resuelve la clínica por el phone_number_id de WhatsApp.
    const phoneNumberId = value?.metadata?.phone_number_id;
    const clinic = await prisma.clinic.findFirst({
      where: { waPhoneNumberId: phoneNumberId },
    });
    if (!clinic) return NextResponse.json({ ok: true });

    // Dedup por wamid: Meta reintenta el webhook ante timeouts/5xx. Si este
    // mensaje ya fue ingestado, salir antes de crear el IN y de runBotTurn
    // (sin esto el bot llama a Claude y responde DOS veces, cobrando doble).
    if (msg.id) {
      const duplicate = await prisma.inboxMessage.findFirst({
        where: { externalId: msg.id, thread: { clinicId: clinic.id } },
        select: { id: true },
      });
      if (duplicate) return NextResponse.json({ ok: true });
    }

    // Empareja al paciente por teléfono (Meta manda "521234567890" → últimos 10).
    const fromNormalized = from.replace(/^52/, "").slice(-10);
    const patient = await prisma.patient.findFirst({
      where: { clinicId: clinic.id, phone: { contains: fromNormalized } },
      select: { id: true },
    });

    // ── Ingest al Inbox unificado (generalizado para Meta, igual que Twilio) ──
    const profileName = value?.contacts?.[0]?.profile?.name as string | undefined;
    const now = new Date();
    const externalThreadKey = from; // teléfono del remitente: estable por contacto

    let thread = await prisma.inboxThread.findFirst({
      where: { clinicId: clinic.id, channel: "WHATSAPP", externalId: externalThreadKey },
      select: { id: true, botActive: true, botState: true, patientId: true },
    });
    if (!thread) {
      thread = await prisma.inboxThread.create({
        data: {
          clinicId: clinic.id,
          channel: "WHATSAPP",
          externalId: externalThreadKey,
          patientId: patient?.id ?? null,
          subject: profileName ? `WhatsApp · ${profileName}` : `WhatsApp · ${from}`,
          status: "UNREAD",
          lastMessageAt: now,
        },
        select: { id: true, botActive: true, botState: true, patientId: true },
      });
    } else {
      await prisma.inboxThread.update({
        where: { id: thread.id },
        data: {
          status: "UNREAD",
          lastMessageAt: now,
          // si identificamos al paciente y el hilo no lo tenía, lo vinculamos.
          ...(patient && !thread.patientId ? { patientId: patient.id } : {}),
        },
      });
    }

    const inMsg = await prisma.inboxMessage.create({
      data: {
        threadId: thread.id,
        direction: "IN",
        body: rawText,
        externalId: msg.id,
        sentAt: now,
      },
      select: { id: true },
    });

    // ── CONSERVA el flujo de confirmar/cancelar recordatorios (igual que hoy) ──
    // Solo aplica si hay un WhatsAppReminder SENT pendiente para este paciente.
    const reminder = patient
      ? await prisma.whatsAppReminder.findFirst({
          where: {
            clinicId:    clinic.id,
            appointment: { patientId: patient.id },
            status:      "SENT",
            repliedAt:   null,
          },
          include: { appointment: true },
          orderBy: { sentAt: "desc" },
        })
      : null;

    if (reminder) {
      // Palabra completa (\b) vía helpers del bot: con substring, "necesito
      // cancelar" contiene "si" y CONFIRMABA. Cancelar se evalúa PRIMERO para
      // frases ambiguas ("mejor no, sí cancélala"); "1"/"2" solo por igualdad
      // exacta (rawText ya viene trimmed).
      const isCancel  = text === "2" || isCancelWord(text) || isNegative(text);
      const isConfirm = !isCancel && (text === "1" || isAffirmative(text));

      if (isCancel) {
        await prisma.appointment.update({
          where: { id: reminder.appointmentId },
          data:  { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Cancelado por paciente vía WhatsApp" },
        });
        await prisma.$executeRaw`UPDATE whatsapp_reminders SET "patientReply"=${text}, "repliedAt"=NOW() WHERE id=${reminder.id}`;

        if (clinic.waAccessToken && clinic.waPhoneNumberId) {
          await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from,
            `❌ Tu cita ha sido *cancelada*. Si deseas reagendar, comunícate con nosotros. ¡Hasta pronto!`
          );
        }
      } else if (isConfirm) {
        await prisma.appointment.update({
          where: { id: reminder.appointmentId },
          data:  { status: "CONFIRMED", confirmedAt: new Date() },
        });
        await prisma.$executeRaw`UPDATE whatsapp_reminders SET "patientReply"=${text}, "repliedAt"=NOW() WHERE id=${reminder.id}`;

        if (clinic.waAccessToken && clinic.waPhoneNumberId) {
          const appt = reminder.appointment;
          const dateStr = new Intl.DateTimeFormat("es-MX", {
            timeZone: clinic.timezone, weekday: "long", day: "numeric", month: "long",
          }).format(appt.startsAt);
          await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from,
            `✅ ¡Perfecto! Tu cita del ${dateStr} a las ${timeHHMMInTz(appt.startsAt, clinic.timezone)} está *confirmada*. Te esperamos. 😊`
          );
        }
      } else {
        // Guarda la respuesta sin cambiar el estado de la cita.
        await prisma.$executeRaw`UPDATE whatsapp_reminders SET "patientReply"=${text}, "repliedAt"=NOW() WHERE id=${reminder.id}`;
      }

      return NextResponse.json({ ok: true });
    }

    // ── Sin recordatorio pendiente → bot híbrido configurable (FAQ + Claude + agenda) ──
    // Memoria del bot: últimos 10 mensajes del hilo en orden cronológico, sin
    // notas internas ni el IN recién creado (ese va como incomingText; ai.ts ya
    // lo agrega como último turno user y lo duplicaría).
    const recentMessages = await prisma.inboxMessage.findMany({
      where: { threadId: thread.id, isInternal: false, id: { not: inMsg.id } },
      orderBy: { sentAt: "desc" },
      take: 10,
      select: { direction: true, body: true, sentById: true },
    });
    const history: BotHistoryItem[] = recentMessages.reverse().map((m) => ({
      role: m.direction === "IN" ? "patient" : m.sentById ? "staff" : "bot",
      text: m.body,
    }));

    const result = await runBotTurn({
      clinicId: clinic.id,
      threadId: thread.id,
      patient: patient ? { id: patient.id, phone: from } : undefined,
      incomingText: rawText,
      history,
      botState: (thread.botState ?? null) as Prisma.JsonValue | null,
    });

    if (result.reply && clinic.waAccessToken && clinic.waPhoneNumberId) {
      await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from, result.reply);
      await prisma.inboxMessage.create({
        data: { threadId: thread.id, direction: "OUT", body: result.reply, sentAt: new Date() },
      });
    }

    // Persiste el estado multi-turno del bot (undefined ⇒ no cambiar).
    if (result.newBotState !== undefined) {
      await prisma.inboxThread.update({
        where: { id: thread.id },
        data: { botState: result.newBotState === null ? Prisma.DbNull : (result.newBotState as Prisma.InputJsonValue) },
      });
    }
    // handoff: no se responde; el mensaje ya quedó en el Inbox para el staff.

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("WhatsApp webhook error:", err);
    return NextResponse.json({ ok: true }); // siempre 200 para evitar reintentos de Meta
  }
}
