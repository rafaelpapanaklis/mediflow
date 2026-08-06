import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHmac, timingSafeEqual } from "crypto";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { runBotTurn } from "@/lib/whatsapp/bot/engine";
import { classifyReminderReply } from "@/lib/whatsapp/reminder-reply";
import { findPatientByWhatsAppPhone, upsertWhatsAppThread } from "@/lib/whatsapp/inbox-log";
import { SYSTEM_EXTERNAL_ID_PREFIX, buildSystemExternalId } from "@/lib/whatsapp/system-message";
import { rateLimitKey } from "@/lib/rate-limit";
import type { BotHistoryItem } from "@/lib/whatsapp/bot/types";
import { Prisma } from "@prisma/client";
import {
  WA_REMINDER_STATUS,
  WA_REMINDER_CONFIRMABLE_TYPES,
  WA_REMINDER_REPLYABLE_APPT_STATUSES,
} from "@/lib/whatsapp/reminder-status";

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
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const body = JSON.parse(rawBody);

    // Extract message from WhatsApp webhook payload
    const entry    = body?.entry?.[0];
    const changes  = entry?.changes?.[0];
    const value    = changes?.value;

    // ── Coexistence: la clínica respondió al paciente DESDE su app de WhatsApp
    //    Business del celular (mismo número conectado al panel). Meta lo entrega
    //    como `smb_message_echoes` (no `messages`). Lo reflejamos en el Inbox
    //    como saliente de la clínica y PAUSAMOS el bot del hilo (un humano tomó
    //    la conversación) para no responder doble. No corre runBotTurn.
    if (changes?.field === "smb_message_echoes") {
      await ingestBusinessAppEchoes(value);
      return NextResponse.json({ ok: true });
    }

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

    // Empareja al paciente por teléfono (últimos 10 dígitos normalizados en
    // ambos lados; el `contains` de la query solo pre-filtra en la BD).
    const patient = await findPatientByWhatsAppPhone(clinic.id, from);

    // ── Ingest al Inbox unificado (generalizado para Meta, igual que Twilio) ──
    const profileName = value?.contacts?.[0]?.profile?.name as string | undefined;
    const now = new Date();
    const externalThreadKey = from; // teléfono del remitente: estable por contacto

    // Upsert compartido con los envíos automáticos (lib/whatsapp/inbox-log):
    // mismo criterio de hilo, misma captura de P2002 ante reintentos de Meta y
    // misma vinculación perezosa del paciente.
    const thread = await upsertWhatsAppThread({
      clinicId: clinic.id,
      externalId: externalThreadKey,
      now,
      createSubject: profileName ? `WhatsApp · ${profileName}` : `WhatsApp · ${from}`,
      createStatus: "UNREAD",
      patientId: patient?.id ?? null,
      markUnread: true,
    });

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

    // ── CONSERVA el flujo de confirmar/cancelar recordatorios ──
    // Recordatorios SENT sin respuesta de este paciente, del más reciente al
    // más viejo. Se leen varios (antes solo el último) para poder PRIORIZAR el
    // que de verdad pide confirmar/cancelar por encima de uno más nuevo que no
    // lo pide — p. ej. una encuesta post-cita encolada después del recordatorio
    // de una cita futura.
    const pendingReminders = patient
      ? await prisma.whatsAppReminder.findMany({
          where: {
            clinicId:    clinic.id,
            appointment: { patientId: patient.id },
            status:      WA_REMINDER_STATUS.SENT,
            repliedAt:   null,
          },
          include: { appointment: true },
          orderBy: { sentAt: "desc" },
          // Tope de seguridad: con más de 10 recordatorios sin contestar el
          // accionable podría quedar fuera (peor caso: la confirmación no se
          // registra y el mensaje espera al staff en el Inbox — nunca se
          // reescribe una cita ajena, que era el daño real).
          take: 10,
        })
      : [];

    // Accionable = el recordatorio que PIDE confirmar/cancelar (APPT_AUTO,
    // APPOINTMENT legacy o MANUAL) Y cuya cita sigue viva. Sin este filtro,
    // contestar la encuesta de seguimiento (FOLLOWUP) reabría o cancelaba una
    // cita ya atendida —probablemente facturada— y el paciente recibía
    // "❌ Tu cita ha sido cancelada" justo después de opinar.
    const actionable =
      pendingReminders.find(
        (r) =>
          WA_REMINDER_CONFIRMABLE_TYPES.includes(r.type) &&
          !!r.appointment &&
          WA_REMINDER_REPLYABLE_APPT_STATUSES.includes(r.appointment.status),
      ) ?? null;
    const reminder = actionable ?? pendingReminders[0] ?? null;

    if (reminder) {
      // Clasificación pura compartida con los tests (classifyReminderReply):
      // cancelar se evalúa PRIMERO para frases ambiguas ("mejor no, sí
      // cancélala"); "1"/"2" solo por igualdad exacta (rawText ya viene trimmed).
      // Si el recordatorio no es accionable, la respuesta se guarda pero NO
      // toca la cita (misma rama "none" de siempre).
      const reply = reminder === actionable ? classifyReminderReply(text) : "none";

      if (reply === "cancel") {
        await prisma.appointment.update({
          where: { id: reminder.appointmentId },
          data:  { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Cancelado por paciente vía WhatsApp" },
        });
        await prisma.$executeRaw`UPDATE whatsapp_reminders SET "patientReply"=${text}, "repliedAt"=NOW() WHERE id=${reminder.id}`;

        if (clinic.waAccessToken && clinic.waPhoneNumberId) {
          const body = `❌ Tu cita ha sido *cancelada*. Si deseas reagendar, comunícate con nosotros. ¡Hasta pronto!`;
          await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from, body);
          await logAutoReply(thread.id, body);
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
          const body = `✅ ¡Perfecto! Tu cita del ${dateStr} a las ${timeHHMMInTz(appt.startsAt, clinic.timezone)} está *confirmada*. Te esperamos. 😊`;
          await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from, body);
          await logAutoReply(thread.id, body);
        }
      } else {
        // Guarda la respuesta sin cambiar el estado de la cita.
        await prisma.$executeRaw`UPDATE whatsapp_reminders SET "patientReply"=${text}, "repliedAt"=NOW() WHERE id=${reminder.id}`;
      }

      return NextResponse.json({ ok: true });
    }

    // ── El staff tomó el control del hilo → el bot calla ──
    // botActive=false lo pone (a) el handoff del propio bot o (b) un echo de
    // coexistence (la clínica ya respondió al paciente desde su WhatsApp del
    // cel). El mensaje entrante ya quedó arriba en el Inbox para que lo atienda
    // una persona; NO llamamos a runBotTurn para no responder encima del humano.
    if (thread.botActive === false) {
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
        // Los envíos automáticos de la plataforma (recordatorios, reseñas,
        // recetas, avisos…) también son OUT con sentById null desde que quedan
        // registrados en el Inbox, pero NO son respuestas del bot y no gastan
        // Claude: se excluyen por el prefijo `sys:` de su externalId. El OR con
        // `externalId: null` es imprescindible — un `NOT LIKE` en SQL descarta
        // las filas NULL, que es justo como se guardan las respuestas del bot.
        OR: [
          { externalId: null },
          { NOT: { externalId: { startsWith: SYSTEM_EXTERNAL_ID_PREFIX } } },
        ],
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

/**
 * Registra en el Inbox una respuesta automática del flujo de recordatorios
 * (confirmar / cancelar cita). Best-effort: si falla, el WhatsApp ya salió y el
 * webhook debe seguir respondiendo 200 a Meta.
 *
 * Va marcada con `sys:reminder:` para quedar FUERA del tope diario del bot
 * (BOT_DAILY_REPLY_CAP), que es exactamente como se comportaba antes: estas dos
 * respuestas no se registraban y por tanto nunca consumieron ese presupuesto.
 */
async function logAutoReply(threadId: string, body: string): Promise<void> {
  try {
    await prisma.inboxMessage.create({
      data: {
        threadId,
        direction: "OUT",
        body,
        sentAt: new Date(),
        externalId: buildSystemExternalId("reminder"),
      },
    });
  } catch (e) {
    console.error("[whatsapp/webhook] no se pudo registrar la respuesta automática:", e);
  }
}

/**
 * Coexistence: ingesta los mensajes que la clínica envió al paciente DESDE su
 * app de WhatsApp Business del celular (mismo número conectado al panel). Meta
 * los entrega como `smb_message_echoes` (field hermano de `value`), con
 * `value.message_echoes[]` (from = número del negocio, to = paciente). Cada eco
 * se refleja como mensaje OUT en el Inbox (sentById null: aparece como enviado
 * por la clínica, no por un usuario concreto) y PAUSA el bot del hilo
 * (botActive=false) — un humano está respondiendo, para evitar doble respuesta.
 * Solo texto por ahora (los echoes de tipo revoke/edit no traen text.body y se
 * ignoran). El bot se reactiva con el toggle del hilo en el Inbox.
 */
async function ingestBusinessAppEchoes(value: any) {
  const phoneNumberId = value?.metadata?.phone_number_id;
  const echoes = Array.isArray(value?.message_echoes) ? value.message_echoes : [];
  if (!phoneNumberId || echoes.length === 0) return;

  const clinic = await prisma.clinic.findFirst({
    where: { waPhoneNumberId: phoneNumberId },
    select: { id: true },
  });
  if (!clinic) return;

  for (let i = 0; i < echoes.length; i++) {
    const echo = echoes[i];
    const to   = (echo?.to as string | undefined)?.trim();  // teléfono del paciente
    const text = echo?.text?.body?.trim() ?? "";            // solo texto por ahora
    if (!to || !text) continue;

    // Empareja al paciente por los últimos 10 dígitos normalizados (igual que el
    // flujo entrante). El `contains` solo pre-filtra en la BD; el match es exacto.
    const patient = await findPatientByWhatsAppPhone(clinic.id, to);

    const now = new Date();
    const thread = await upsertWhatsAppThread({
      clinicId: clinic.id,
      externalId: to,
      now,
      createSubject: `WhatsApp · ${to}`,
      createStatus: "READ",   // saliente de la clínica: no es algo "sin leer"
      patientId: patient?.id ?? null,
      pauseBot: true,         // un humano está atendiendo este hilo
    });

    try {
      await prisma.inboxMessage.create({
        data: {
          threadId: thread.id,
          direction: "OUT",
          body: text,
          externalId: echo?.id ?? null, // dedup por wamid (Meta reintenta)
          sentAt: now,
        },
      });
    } catch (err) {
      // @@unique [threadId, externalId]: eco ya ingestado por un reintento → ok.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
}
