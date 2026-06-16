import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHmac, timingSafeEqual } from "crypto";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { runBotTurn } from "@/lib/whatsapp/bot/engine";
import { classifyReminderReply } from "@/lib/whatsapp/reminder-reply";
import { normalizeLast10 } from "@/lib/whatsapp/bot/booking-parse";
import { rateLimitKey } from "@/lib/rate-limit";
import type { BotHistoryItem } from "@/lib/whatsapp/bot/types";
import { Prisma } from "@prisma/client";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";

// Tope diario de respuestas del bot por clínica (proxy de gasto: cada
// respuesta OUT del bot ≈ 1 llamada a Claude + 1 envío de WhatsApp).
const BOT_DAILY_REPLY_CAP = parseInt(process.env.WA_BOT_DAILY_REPLY_CAP ?? "", 10) || 200;
const BOT_CAP_REACHED_MSG =
  "Por el momento te atiende un humano 🙋: tu mensaje quedó registrado y el equipo de la clínica te responderá en breve.";

// GET — webhook verification by Meta
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  // Sin fallback hardcodeado: si la env no está configurada, no hay forma
  // legítima de verificar el webhook.
  const verifyToken = process.env.WA_WEBHOOK_VERIFY_TOKEN;
  if (!verifyToken) {
    console.error("[whatsapp/webhook] WA_WEBHOOK_VERIFY_TOKEN no configurado — rechazando verificación");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    // Comparación en tiempo constante; timingSafeEqual exige buffers del mismo
    // largo (el largo del HMAC es público, comparar length no filtra nada).
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      // TEMP DEBUG (quitar): diagnostica por qué la firma no coincide. No expone
      // el secret (solo su largo); recv/exp son hashes públicos.
      console.error("WA_SIG_DEBUG " + JSON.stringify({
        secretLen: appSecret.length,
        secretHasWs: /\s/.test(appSecret),
        bodyLen: rawBody.length,
        recv: signature,
        exp: expectedSig,
      }));
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

    // Empareja al paciente por teléfono comparando los últimos 10 dígitos
    // NORMALIZADOS en ambos lados (no `contains` crudo, que da falsos positivos
    // cuando esos 10 dígitos aparecen como substring de otro número). El
    // `contains` solo pre-filtra en la BD; el match real lo hace normalizeLast10.
    const fromLast10 = normalizeLast10(from);
    const phoneCandidates = fromLast10.length === 10
      ? await prisma.patient.findMany({
          where: { clinicId: clinic.id, phone: { contains: fromLast10 } },
          select: { id: true, phone: true },
          take: 25,
        })
      : [];
    const patient =
      phoneCandidates.find((p) => normalizeLast10(p.phone ?? "") === fromLast10) ?? null;

    // ── Ingest al Inbox unificado (generalizado para Meta, igual que Twilio) ──
    const profileName = value?.contacts?.[0]?.profile?.name as string | undefined;
    const now = new Date();
    const externalThreadKey = from; // teléfono del remitente: estable por contacto

    let thread = await prisma.inboxThread.findFirst({
      where: { clinicId: clinic.id, channel: "WHATSAPP", externalId: externalThreadKey },
      select: { id: true, botActive: true, botState: true, patientId: true },
    });
    if (!thread) {
      try {
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
      } catch (err) {
        // Carrera entre reintentos de Meta: otro request creó el hilo entre el
        // findFirst y el create (@@unique [clinicId, channel, externalId]) →
        // re-busca el hilo existente y úsalo.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          thread = await prisma.inboxThread.findFirst({
            where: { clinicId: clinic.id, channel: "WHATSAPP", externalId: externalThreadKey },
            select: { id: true, botActive: true, botState: true, patientId: true },
          });
        }
        if (!thread) throw err;
      }
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

    let inMsg: { id: string };
    try {
      inMsg = await prisma.inboxMessage.create({
        data: {
          threadId: thread.id,
          direction: "IN",
          body: rawText,
          externalId: msg.id,
          sentAt: now,
        },
        select: { id: true },
      });
    } catch (err) {
      // @@unique [threadId, externalId]: el mensaje ya fue ingestado por un
      // request concurrente (carrera que el dedup por wamid de arriba no
      // alcanza a ver) → ya está procesado o procesándose, salir limpio.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ ok: true });
      }
      throw err;
    }

    // ── CONSERVA el flujo de confirmar/cancelar recordatorios (igual que hoy) ──
    // Solo aplica si hay un WhatsAppReminder SENT pendiente para este paciente.
    const reminder = patient
      ? await prisma.whatsAppReminder.findFirst({
          where: {
            clinicId:    clinic.id,
            appointment: { patientId: patient.id },
            status:      WA_REMINDER_STATUS.SENT,
            repliedAt:   null,
          },
          include: { appointment: true },
          orderBy: { sentAt: "desc" },
        })
      : null;

    if (reminder) {
      // Clasificación pura compartida con los tests (classifyReminderReply):
      // cancelar se evalúa PRIMERO para frases ambiguas ("mejor no, sí
      // cancélala"); "1"/"2" solo por igualdad exacta (rawText ya viene trimmed).
      const reply = classifyReminderReply(text);

      if (reply === "cancel") {
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
      } else if (reply === "confirm") {
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

    // ── Rate-limit del bot (anti-spam, anti-drenaje del wallet) ──
    // Por remitente (wa_id) y por clínica, ANTES de llamar a Claude. Al
    // excederse NO se responde (responder aquí permitiría spam de envíos
    // salientes); el mensaje ya quedó arriba en el Inbox para el staff.
    const senderAllowed = rateLimitKey(`wa-bot:${clinic.id}:${from}`, 6, 60_000);
    const clinicAllowed = rateLimitKey(`wa-bot-clinic:${clinic.id}`, 60, 60_000);
    if (!senderAllowed || !clinicAllowed) {
      return NextResponse.json({ ok: true });
    }

    // ── Tope diario de gasto del bot por clínica ──
    // Cuenta las respuestas OUT del bot (sentById null = automáticas) de las
    // últimas 24h. Al excederlo no se llama a Claude: se avisa máximo una vez
    // por hilo al día que atiende un humano, y el resto queda en el Inbox.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const botRepliesToday = await prisma.inboxMessage.count({
      where: {
        thread: { clinicId: clinic.id },
        direction: "OUT",
        sentById: null,
        sentAt: { gte: dayAgo },
      },
    });
    if (botRepliesToday >= BOT_DAILY_REPLY_CAP) {
      const alreadyNotified = await prisma.inboxMessage.findFirst({
        where: { threadId: thread.id, direction: "OUT", body: BOT_CAP_REACHED_MSG, sentAt: { gte: dayAgo } },
        select: { id: true },
      });
      if (!alreadyNotified && clinic.waAccessToken && clinic.waPhoneNumberId) {
        await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from, BOT_CAP_REACHED_MSG);
        await prisma.inboxMessage.create({
          data: { threadId: thread.id, direction: "OUT", body: BOT_CAP_REACHED_MSG, sentAt: new Date() },
        });
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

    // Persiste el estado multi-turno del bot y, si el bot deriva a humano
    // (handoff), PAUSA el bot en el hilo (botActive=false) para que no vuelva a
    // responder hasta que el staff lo reactive. handoff no responde: el mensaje
    // ya quedó en el Inbox para una persona.
    const threadUpdate: Prisma.InboxThreadUpdateInput = {};
    if (result.newBotState !== undefined) {
      threadUpdate.botState = result.newBotState === null ? Prisma.DbNull : (result.newBotState as Prisma.InputJsonValue);
    }
    if (result.handoff) {
      threadUpdate.botActive = false;
    }
    if (Object.keys(threadUpdate).length > 0) {
      await prisma.inboxThread.update({ where: { id: thread.id }, data: threadUpdate });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("WhatsApp webhook error:", err);
    return NextResponse.json({ ok: true }); // siempre 200 para evitar reintentos de Meta
  }
}
