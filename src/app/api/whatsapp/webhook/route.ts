import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHmac, timingSafeEqual } from "crypto";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { runBotTurn } from "@/lib/whatsapp/bot/engine";
import { actionablePatientIds, asksToConfirmOrCancel, resolveReminderReply } from "@/lib/whatsapp/reminder-pick";
import { esRespuestaDeEncuesta } from "@/lib/whatsapp/reminder-reply";
import { detectaIntencionDeAgenda } from "@/lib/whatsapp/bot/booking-parse";
import { extraerEventosDelWebhook, phoneNumberIdDe } from "@/lib/whatsapp/webhook-eventos";
import { conTurnoDelHilo } from "@/lib/whatsapp/bot-turno";
import { persistentRateLimitKey } from "@/lib/failban";
import { anotarHandoffEnInbox, leerHandoff, reactivarBotSiVencioHandoff } from "@/lib/whatsapp/bot/handoff";
import {
  findPatientByWhatsAppPhone,
  findPatientsByWhatsAppPhone,
  upsertWhatsAppThread,
} from "@/lib/whatsapp/inbox-log";
import {
  BOT_REPLY_EXTERNAL_ID_PREFIX,
  SYSTEM_EXTERNAL_ID_PREFIX,
  buildBotReplyExternalId,
  buildSystemExternalId,
  WHATSAPP_SEND_KINDS,
} from "@/lib/whatsapp/system-message";
import {
  applyDeliveryStatus,
  metaTimestampToDate,
  parseDeliveryStatus,
} from "@/lib/whatsapp/delivery-status";
import { WA_ERROR_CODE, formatWaErrorMessage, isTokenRevoked, waErrorCode } from "@/lib/whatsapp/errors";
import { markWhatsAppDisconnected } from "@/lib/whatsapp/connection";
import { ingestTemplateStatusUpdate } from "@/lib/whatsapp/provision-templates";
import { cancelPendingRemindersForAppointment } from "@/lib/reminders/reschedule.server";
import type { BotHistoryItem } from "@/lib/whatsapp/bot/types";
import { Prisma } from "@prisma/client";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";
import { marcarPendienteSiHayDinero } from "@/lib/anticipos/cita-cancelada.server";
import { anotarRespuestaARecordatorio } from "@/lib/whatsapp/bot/movimientos-bot";
import { sincronizarCitaEnSegundoPlano } from "@/lib/agenda/google-sync";

// Tope diario de respuestas del bot por clínica (proxy de gasto: cada
// respuesta OUT del bot ≈ 1 llamada a Claude + 1 envío de WhatsApp).
const BOT_DAILY_REPLY_CAP = parseInt(process.env.WA_BOT_DAILY_REPLY_CAP ?? "", 10) || 200;
const BOT_CAP_REACHED_MSG =
  "Por el momento te atiende un humano 🙋: tu mensaje quedó registrado y el equipo de la clínica te responderá en breve.";

// El recordatorio le pidió al paciente responder CONFIRMAR o CANCELAR
// (lib/reminders/config.ts) y contestó otra cosa. Antes esto se guardaba en
// silencio —el paciente creía que había confirmado— y encima quemaba el
// recordatorio. Ahora se le dice, con las mismas dos palabras que le pedimos.
const REMINDER_UNCLEAR_MSG =
  "🤔 No te entendí. Responde *CONFIRMAR* para confirmar tu cita o *CANCELAR* si no podrás asistir.";

// ws1-t3 #1 — el paciente contestó algo que suena a «no voy» pero sin decir
// CANCELAR. Antes eso cancelaba la cita en el acto; ahora se le pide la palabra.
function textoPreguntaCancelar(fecha: string, hora: string): string {
  return (
    `Para cancelar tu cita del ${fecha} a las ${hora}, responde *CANCELAR*. ` +
    "Si sí vas a asistir, responde *CONFIRMAR*. 🙏"
  );
}

// ws1-t3 #1 — quiere mover la cita y el bot puede agendar, pero la frase no
// basta para abrir el flujo de reagendar («mejor otro día»).
const REMINDER_RESCHEDULE_HINT_MSG =
  "📅 Para cambiar tu cita, escribe *REAGENDAR* y te muestro los horarios disponibles.";

// ws1-t3 #1 — quiere mover la cita y el bot no puede agendar (apagado, sin
// agenda o con el hilo en manos del equipo).
const REMINDER_RESCHEDULE_STAFF_MSG =
  "📅 Para cambiar tu cita, el equipo de la clínica te escribe en un momento. 🙏";

// Varios pacientes de la clínica comparten este teléfono y más de uno tiene
// cita por confirmar. Confirmar "la que sea" le movería la agenda a otra
// persona, así que esto lo resuelve el staff desde el Inbox.
const REMINDER_AMBIGUOUS_MSG =
  "📋 Con este número tenemos más de una cita por confirmar y no sabemos cuál es la tuya. " +
  "Para no mover la de otra persona, el equipo de la clínica te escribe en un momento. 🙏";

// El paciente mandó algo que no es texto (foto, nota de voz, PDF…). El bot no
// lo va a contestar (no sabe qué hay dentro) y el staff puede tardar: se le
// confirma que llegó, para que no se quede mirando una sola palomita.
const MEDIA_RECEIVED_MSG = "Recibí tu archivo, en un momento te atiende una persona.";

/** Adjunto entrante tal y como se guarda en `InboxMessage.attachments` (Json). */
type IncomingAttachment = {
  kind: "image" | "video" | "audio" | "document" | "sticker";
  /** Media id de Meta; el binario se pide con él (api/whatsapp/media). */
  mediaId: string;
  mime?: string;
  filename?: string;
};

/**
 * Describe en una frase, para el Inbox, un mensaje entrante que NO es texto,
 * y extrae sus adjuntos (por media id: aquí no se descarga nada).
 *
 * Existe porque el webhook tiraba en silencio todo lo que no fuera `text`. El
 * objetivo es que nada vuelva a desaparecer: por eso un tipo desconocido NO
 * devuelve null sino una frase honesta ("el panel todavía no sabe mostrarlo").
 * Solo devuelve null para `text` (ese ya lo cubre rawText; si venía vacío no
 * hay nada que contar).
 *
 * Ubicación, contacto y reacción NO llevan adjunto: dos números o un nombre
 * pesan cero y el texto sirve tal cual.
 */
function describeIncoming(msg: any): { body: string; attachments: IncomingAttachment[] | null } | null {
  if (!msg || msg.type === "text") return null;

  const media = (kind: IncomingAttachment["kind"], obj: any): IncomingAttachment[] | null => {
    if (typeof obj?.id !== "string" || obj.id.length === 0) return null;
    const att: IncomingAttachment = { kind, mediaId: obj.id };
    if (typeof obj.mime_type === "string" && obj.mime_type) att.mime = obj.mime_type;
    if (typeof obj.filename === "string" && obj.filename.trim()) att.filename = obj.filename.trim();
    return [att];
  };
  // El pie de foto que escribió el paciente va detrás de la descripción.
  const withCaption = (body: string, obj: any): string => {
    const caption = typeof obj?.caption === "string" ? obj.caption.trim() : "";
    return caption ? `${body} — ${caption}` : body;
  };

  switch (msg.type) {
    case "image":
      return { body: withCaption("📷 Te mandaron una foto", msg.image), attachments: media("image", msg.image) };
    case "video":
      return { body: withCaption("🎥 Te mandaron un video", msg.video), attachments: media("video", msg.video) };
    case "audio":
      return {
        body: msg.audio?.voice === true ? "🎤 Te mandaron una nota de voz" : "🎵 Te mandaron un audio",
        attachments: media("audio", msg.audio),
      };
    case "document": {
      const filename = typeof msg.document?.filename === "string" ? msg.document.filename.trim() : "";
      return {
        body: withCaption(`📄 Te mandaron el archivo ${filename || "sin nombre"}`, msg.document),
        attachments: media("document", msg.document),
      };
    }
    case "sticker":
      return { body: "Te mandaron una calcomanía", attachments: media("sticker", msg.sticker) };
    case "location": {
      const lat = Number(msg.location?.latitude);
      const lng = Number(msg.location?.longitude);
      let body = "📍 Te mandaron su ubicación";
      if (Number.isFinite(lat) && Number.isFinite(lng)) body += `: https://maps.google.com/?q=${lat},${lng}`;
      const place = [msg.location?.name, msg.location?.address]
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((v) => v.trim())
        .join(", ");
      if (place) body += ` — ${place}`;
      return { body, attachments: null };
    }
    case "contacts": {
      const contacts: any[] = Array.isArray(msg.contacts) ? msg.contacts : [];
      const names = contacts
        .map((c) => {
          const name = typeof c?.name?.formatted_name === "string" ? c.name.formatted_name.trim() : "";
          // El teléfono es lo que la clínica necesita del contacto: sin él la
          // tarjeta no sirve de nada desde el panel.
          const phone = typeof c?.phones?.[0]?.phone === "string" ? c.phones[0].phone.trim() : "";
          return phone ? `${name || "sin nombre"} (${phone})` : name;
        })
        .filter((s) => s.length > 0);
      return {
        body: `👤 Te compartieron el contacto de ${names.length > 0 ? names.join(", ") : "alguien"}`,
        attachments: null,
      };
    }
    case "reaction": {
      const emoji = typeof msg.reaction?.emoji === "string" ? msg.reaction.emoji.trim() : "";
      // Emoji vacío = quitó la reacción que había puesto.
      return { body: emoji ? `Reaccionó ${emoji} a un mensaje` : "Quitó su reacción a un mensaje", attachments: null };
    }
    default:
      return {
        body: "Te mandaron un mensaje que el panel todavía no sabe mostrar. Ábrelo en el WhatsApp del consultorio.",
        attachments: null,
      };
  }
}

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

    // ws1-t3 (auditoría del bot, #10): se recorre TODO lo que Meta agrupe en la
    // llamada —varias entradas, cambios y mensajes—, no solo
    // entry[0].changes[0].messages[0]. Cada evento va en su propio try/catch:
    // uno ilegible no puede tumbar a los demás ni hacer que Meta reintente el
    // lote entero (los que ya entraron se descartan por wamid).
    for (const evento of extraerEventosDelWebhook(body)) {
      try {
        switch (evento.tipo) {
          // ── Coexistence: la clínica respondió al paciente DESDE su app de
          //    WhatsApp Business del celular (mismo número conectado al panel).
          //    Se refleja en el Inbox como saliente de la clínica y PAUSA el bot
          //    del hilo (un humano tomó la conversación). No corre runBotTurn.
          case "ecos":
            await ingestBusinessAppEchoes(evento.value);
            break;
          // ── Meta revisó una plantilla (APPROVED / REJECTED). Este aviso NO
          //    trae `metadata.phone_number_id`: el `entry[].id` ES el WABA id,
          //    así que la clínica se resuelve por `waBusinessAccountId`.
          case "plantilla":
            await ingestTemplateStatusUpdate(evento.entryId ?? undefined, evento.value);
            break;
          // ── Estado de entrega REAL (M-06, M-10) de lo que mandamos nosotros.
          case "estados":
            await ingestDeliveryStatuses(evento.value);
            break;
          case "mensaje":
            await procesarMensajeEntrante(evento.value, evento.msg);
            break;
        }
      } catch (err) {
        console.error(`[whatsapp/webhook] evento ${evento.tipo} no procesado:`, err);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("WhatsApp webhook error:", err);
    return NextResponse.json({ ok: true }); // siempre 200 para evitar reintentos de Meta
  }
}

/** Un mensaje entrante del paciente: Inbox, recordatorios y bot. */
async function procesarMensajeEntrante(value: any, msg: any): Promise<void> {
  const from    = msg.from;                       // teléfono del paciente (formato internacional)
  // Texto original (Inbox + bot). Las respuestas por BOTÓN cuentan como texto:
  // un "CONFIRMAR" pulsado —y no escrito— sigue confirmando la cita.
  const rawText = String(
    msg.text?.body ??
    msg.interactive?.button_reply?.title ??
    msg.interactive?.list_reply?.title ??
    msg.button?.text ??
    "",
  ).trim();
  const text    = rawText.toLowerCase();          // para detectar confirmar/cancelar

  if (!from) return;

  // Lo que NO es texto (foto, nota de voz, PDF, ubicación…) antes se tiraba
  // aquí en silencio: la paciente mandaba la foto de su muela y el Inbox no se
  // enteraba de que existió. Ahora se describe en una frase y sus adjuntos
  // viajan en `attachments`; solo se sale si no hay ni texto ni nada que contar.
  const incoming = rawText ? null : describeIncoming(msg);
  if (!rawText && !incoming) return;

  // Resuelve la clínica por el phone_number_id de WhatsApp.
  // ws1-t3 #19: sin phone_number_id NO se resuelve ninguna clínica. Con
  // `undefined` en el where, Prisma descartaba la clave y devolvía la primera
  // clínica de la tabla.
  const phoneNumberId = phoneNumberIdDe(value);
  if (!phoneNumberId) {
    console.warn("[whatsapp/webhook] mensaje sin metadata.phone_number_id: no se asigna a ninguna clínica");
    return;
  }
  const clinic = await prisma.clinic.findUnique({
    where: { waPhoneNumberId: phoneNumberId },
  });
  if (!clinic) {
    // ── DaleControl Barber (producto SEPARADO) ─────────────────────────
    // Meta entrega TODOS los webhooks de una misma app a UNA sola URL, así
    // que los mensajes de las barberías caen aquí. El camino dental se
    // resolvió ARRIBA y no cambia: esto solo corre cuando el
    // phone_number_id no es de ninguna clínica.
    //
    // try/catch + import() dinámico a propósito: ni un fallo del vertical
    // barber ni un fallo al CARGAR su módulo pueden impedir que se entregue
    // el mensaje de una clínica. Un phone_number_id desconocido tampoco
    // truena: se registra y se responde 200 como siempre.
    let handled = false;
    let barberFailed = false;
    try {
      const { ingestBarberInbound } = await import("@/lib/barber/whatsapp");
      handled = await ingestBarberInbound(value, msg);
    } catch (e) {
      barberFailed = true;
      console.error("[whatsapp/webhook] camino barber no aplicado:", e);
    }

    // ── DaleControl Inmuebles (TERCER producto) ────────────────────────
    // Mismo criterio, un escalón más abajo: solo corre cuando el número no
    // es de ninguna clínica NI de ninguna barbería. Sigue dentro del mismo
    // `if (!clinic)`, así que el camino dental no cambia una línea, y el de
    // barber tampoco: su llamada de arriba es idéntica a la que había.
    // También en try/catch con import() dinámico, por lo mismo de siempre.
    //
    // 🔴 `!barberFailed` no es una precaución de más: si barber LANZA, no
    // sabemos si el número era suyo (revienta ANTES de poder decirlo), y
    // dejar que inmuebles lo intente cambiaría el comportamiento de un
    // producto VIVO en su camino de error. Inmuebles es el vertical nuevo
    // y sin clientes: cuando hay duda, el que se queda sin correr es él.
    // Consecuencia asumida: si barber falla en serio, inmuebles deja de
    // recibir. Es el lado correcto en el que fallar.
    if (!handled && !barberFailed) {
      try {
        const { ingestRealtyInbound } = await import("@/lib/realty/whatsapp");
        handled = await ingestRealtyInbound(value, msg);
      } catch (e) {
        console.error("[whatsapp/webhook] camino inmuebles no aplicado:", e);
      }
    }

    // El aviso solo cuando de verdad nadie lo reconoció. Si barber lanzó,
    // ya se registró su error arriba y este renglón mentiría diciendo que
    // el número no tiene dueño.
    if (!handled && !barberFailed) {
      console.warn(`[whatsapp/webhook] phone_number_id sin dueño: ${phoneNumberId}`);
    }
    return;
  }

  // Dedup por wamid: Meta reintenta el webhook ante timeouts/5xx. Si este
  // mensaje ya fue ingestado, salir antes de crear el IN y de runBotTurn
  // (sin esto el bot llama a Claude y responde DOS veces, cobrando doble).
  if (msg.id) {
    const duplicate = await prisma.inboxMessage.findFirst({
      where: { externalId: msg.id, thread: { clinicId: clinic.id } },
      select: { id: true },
    });
    if (duplicate) return;
  }

  // Empareja al paciente por teléfono (últimos 10 dígitos normalizados en
  // ambos lados; el `contains` de la query solo pre-filtra en la BD).
  //
  // Se leen TODOS los pacientes de la clínica con ese número, no solo el
  // primero: en producción hay teléfonos compartidos (hermanos con el celular
  // de la mamá — se han visto 6 pacientes con el mismo número). `patient`
  // sigue siendo el primero, que es a quien se atribuye el hilo y el turno del
  // bot; lo que cambia es que la búsqueda del recordatorio ya no se queda con
  // él: si la cita era de otro hermano, antes no se encontraba nada y el
  // "CONFIRMAR" moría en silencio.
  const phoneOwners = await findPatientsByWhatsAppPhone(clinic.id, from);
  const patient = phoneOwners[0] ?? null;

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
        // Texto del paciente o, si no mandó texto, la frase que describe lo
        // que mandó (el guard de arriba garantiza que hay una de las dos).
        body: rawText || incoming!.body,
        attachments: incoming?.attachments ?? undefined,
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
      return;
    }
    throw err;
  }

  // ── Multimedia: se avisa que llegó y AQUÍ TERMINA ──
  // Una foto no es un "CONFIRMAR" (no puede tocar recordatorios ni citas) y el
  // bot no debe contestarle a un texto que se inventó el propio sistema. Por
  // eso este return va ANTES del bloque de recordatorios y ANTES de runBotTurn.
  // El hilo ya quedó sin leer (markUnread arriba), que es lo que lo pone en
  // "Necesitan atención ahora".
  if (incoming) {
    // Si el bot sigue activo nadie más va a contestar de inmediato: se le
    // dice a la paciente que su archivo llegó (máximo uno por hora por hilo;
    // el dedupe lo hace sendOnceToThread). Sin esto manda su radiografía y
    // no recibe absolutamente nada. Con el bot en pausa un humano ya está
    // atendiendo, y a una reacción (👍 a un mensaje) no se le contesta:
    // no espera respuesta y "recibí tu archivo" sonaría a error.
    if (thread.botActive !== false && msg.type !== "reaction") {
      await sendOnceToThread({
        clinic,
        threadId: thread.id,
        to: from,
        body: MEDIA_RECEIVED_MSG,
        since: new Date(Date.now() - 60 * 60 * 1000),
      });
    }
    return;
  }

  // ── Respuesta a un recordatorio ──
  // Recordatorios SENT sin respuesta de este paciente, del más reciente al
  // más viejo. Se leen varios (antes solo el último) para poder PRIORIZAR el
  // que de verdad pide confirmar/cancelar por encima de uno más nuevo que no
  // lo pide — p. ej. una encuesta post-cita encolada después del recordatorio
  // de una cita futura.
  const pendingReminders = phoneOwners.length > 0
    ? await prisma.whatsAppReminder.findMany({
        where: {
          clinicId:    clinic.id,
          // TODOS los pacientes con este teléfono, no solo el primero.
          appointment: { patientId: { in: phoneOwners.map((p) => p.id) } },
          status:      WA_REMINDER_STATUS.SENT,
          repliedAt:   null,
        },
        include: { appointment: true },
        orderBy: { sentAt: "desc" },
        // Tope de seguridad: con más de 20 recordatorios sin contestar el
        // accionable podría quedar fuera (peor caso: la confirmación no se
        // registra y el mensaje espera al staff en el Inbox). Sube de 10 a 20
        // porque ahora la lista puede venir de varios pacientes a la vez.
        take: 20,
      })
    : [];

  // Selección + clasificación, ambas puras y testeadas sin BD
  // (lib/whatsapp/reminder-pick.ts y reminder-reply.ts; npm run
  // test:wa-reminder-pick y test:wa-reminder-intencion):
  // - Accionable = el que PIDE confirmar/cancelar (APPT_AUTO, APPOINTMENT
  //   legacy o MANUAL) Y cuya cita sigue viva.
  // - ws1-t3 #1: CANCELA solo una intención clara («cancelar», «cancela mi
  //   cita», el botón, «2»). Un «no» suelto o «no puedo ir» → `ask_cancel`:
  //   se le pide escribir CANCELAR. Una frase con «no» dentro («¿no tienen
  //   estacionamiento?») ya no toca la cita.
  // - `reschedule` = quiere moverla → al flujo de agenda del bot.
  // - `question` (#15) = pregunta normal → al bot, nunca «no te entendí».
  // - `unclear` = el mensaje le pedía confirmar/cancelar y contestó algo CORTO
  //   que no se entiende («Confirmarr» ya confirma; «canselar» no).
  const { reminder, action: reply, unclear } = resolveReminderReply(pendingReminders, text);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // ── Teléfono compartido con citas de VARIAS personas por confirmar ──
  // No se adivina de quién es el "CONFIRMAR": se le dice al paciente que el
  // equipo lo va a resolver y el mensaje se queda en el Inbox (ya está ahí,
  // y el hilo quedó UNREAD). NINGÚN recordatorio se toca: el que de verdad
  // corresponda lo cierra el staff a mano desde la agenda.
  if (actionablePatientIds(pendingReminders).length > 1) {
    const notified = await sendOnceToThread({
      clinic,
      threadId: thread.id,
      to: from,
      body: REMINDER_AMBIGUOUS_MSG,
      since: dayAgo,
    });
    // Ya avisado (o sin credenciales para avisar): no se repite la misma
    // frase en cada mensaje — el resto de la conversación sigue su curso
    // normal hacia el bot / el staff en vez de quedarse muda aquí.
    if (notified) return;
  } else if (reminder) {
    if (reply === "cancel") {
      await prisma.$transaction(async (tx) => {
        await tx.appointment.update({
          where: { id: reminder.appointmentId! },
          data:  { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Cancelado por paciente vía WhatsApp" },
        });
        // El paciente canceló: los avisos que quedaran en cola para esa cita
        // ya no tienen sentido. El SENT al que está contestando no se toca
        // (queda con patientReply/repliedAt, abajo).
        await cancelPendingRemindersForAppointment(tx, {
          appointmentId: reminder.appointmentId!,
          clinicId: clinic.id,
          reason: "Cancelado: el paciente canceló la cita por WhatsApp",
        });
      });
      await recordReminderReply(reminder.id, text, { close: true });
      if (reminder.appointment) await anotarRespuestaARecordatorio({ clinicId: clinic.id, cita: reminder.appointment, accion: "cancel" });
      // Google Calendar: la cita quedó cancelada, el evento se borra. No lanza.
      await sincronizarCitaEnSegundoPlano(clinic.id, reminder.appointmentId!);
      // H15 (ws1-t4): si su factura tiene dinero, queda «pendiente de decidir».
      await marcarPendienteSiHayDinero({ clinicId: clinic.id, appointmentId: reminder.appointmentId!, quien: "el paciente (WhatsApp)" });

      await enviarYRegistrar({
        clinic,
        threadId: thread.id,
        to: from,
        body: `❌ Tu cita ha sido *cancelada*. Si deseas reagendar, comunícate con nosotros. ¡Hasta pronto!`,
        origen: "reminder",
      });
      return;
    } else if (reply === "confirm") {
      await prisma.appointment.update({
        where: { id: reminder.appointmentId },
        data:  { status: "CONFIRMED", confirmedAt: new Date() },
      });
      await recordReminderReply(reminder.id, text, { close: true });
      if (reminder.appointment) await anotarRespuestaARecordatorio({ clinicId: clinic.id, cita: reminder.appointment, accion: "confirm" });

      const appt = reminder.appointment;
      await enviarYRegistrar({
        clinic,
        threadId: thread.id,
        to: from,
        body: `✅ ¡Perfecto! Tu cita del ${fechaLargaDeCita(appt.startsAt, clinic.timezone)} a las ${timeHHMMInTz(appt.startsAt, clinic.timezone)} está *confirmada*. Te esperamos. 😊`,
        origen: "reminder",
      });
      return;
    } else if (reply === "ask_cancel") {
      // ── ws1-t3 #1: suena a que no va, pero no lo dijo claro ──
      // Antes esto cancelaba la cita en el acto. Ahora se le pide la palabra
      // exacta, UNA vez por recordatorio (el texto lleva la fecha de la cita).
      // El recordatorio sigue abierto: su «CANCELAR» o «CONFIRMAR» siguiente
      // entra por las ramas de arriba.
      await recordReminderReply(reminder.id, text, { close: false });
      const appt = reminder.appointment;
      const asked = await sendOnceToThread({
        clinic,
        threadId: thread.id,
        to: from,
        body: textoPreguntaCancelar(
          fechaLargaDeCita(appt.startsAt, clinic.timezone),
          timeHHMMInTz(appt.startsAt, clinic.timezone),
        ),
        since: reminder.sentAt ?? dayAgo,
      });
      if (asked) return;
      // Ya se le preguntó y sigue sin decir CANCELAR: no se insiste con la
      // misma frase ni se adivina; pasa al bot / al equipo.
    } else if (reply === "reschedule") {
      // ── ws1-t3 #1: quiere MOVER la cita, no cancelarla ──
      // El recordatorio queda abierto (si al final la mueve, la agenda
      // reprograma sus avisos). Si el bot puede agendar y entiende la frase
      // como reagendar, la atiende él con la disponibilidad real; si no, se
      // le dice cómo pedirlo o que el equipo le escribe.
      await recordReminderReply(reminder.id, text, { close: false });
      const puede = await botPuedeAgendar(clinic.id, thread.botActive);
      if (!puede || detectaIntencionDeAgenda(rawText) !== "reschedule") {
        const asked = await sendOnceToThread({
          clinic,
          threadId: thread.id,
          to: from,
          body: puede ? REMINDER_RESCHEDULE_HINT_MSG : REMINDER_RESCHEDULE_STAFF_MSG,
          since: reminder.sentAt ?? dayAgo,
        });
        if (asked) return;
      }
      // Sigue al bot: su flujo de agenda reconoce «reagendar».
    } else if (unclear) {
      // ── Un dedazo NO puede inutilizar la confirmación ──
      // El mensaje SÍ le pedía CONFIRMAR/CANCELAR y contestó algo corto que no
      // entendemos ("canselar", "okk"). `repliedAt` significa "esta respuesta
      // CERRÓ el recordatorio", y solo la cierra algo accionable: el texto se
      // guarda en `patientReply` —el staff lo ve— pero la puerta queda abierta.
      await recordReminderReply(reminder.id, text, { close: false });
      const asked = await sendOnceToThread({
        clinic,
        threadId: thread.id,
        to: from,
        body: REMINDER_UNCLEAR_MSG,
        // Una sola aclaración por recordatorio, no por mensaje.
        since: reminder.sentAt ?? dayAgo,
      });
      if (asked) return;
      // Ya se le pidió aclarar y sigue sin decir confirmar ni cancelar: no es
      // un dedazo, es otra conversación. Se deja pasar al bot / al staff.
    } else if (!asksToConfirmOrCancel(reminder)) {
      // ── Lo último que recibió fue una encuesta o un aviso que no pedía nada ──
      // ws1-t3 #5: antes CUALQUIER mensaje posterior se tomaba como respuesta a
      // ese aviso —sin límite de tiempo— y el webhook salía sin pasar por el
      // bot («hola, quiero una cita» tres meses después de la encuesta se
      // quedaba sin respuesta). Ahora solo se toma como respuesta un texto
      // corto, sin pregunta, a un aviso de las últimas 48 h; todo lo demás va
      // al bot y el aviso no se toca.
      if (reply !== "question" && esRespuestaDeEncuesta(text, reminder.sentAt, now)) {
        await recordReminderReply(reminder.id, text, { close: true });
        return;
      }
    }
    // reply === "question" (#15) o texto largo con el recordatorio abierto:
    // no se registra como respuesta y pasa al bot, que la contesta.
  }

  await turnoDelBot({ clinic, thread, inMsg, now, from, rawText, patient });
}

/** El turno del bot para un mensaje que nadie más atendió. */
async function turnoDelBot(args: {
  clinic: { id: string; waAccessToken: string | null; waPhoneNumberId: string | null };
  thread: { id: string; botActive: boolean | null };
  inMsg: { id: string };
  now: Date;
  from: string;
  rawText: string;
  patient: { id: string; firstName: string | null } | null;
}): Promise<void> {
  const { clinic, thread, inMsg, now, from, rawText, patient } = args;

  // Atajo: hilo en pausa SIN marca de handoff (la pausó una persona o un eco
  // del celular) → el bot calla, sin gastar candado ni rate-limit. La pausa de
  // un handoff del bot se evalúa abajo, ya con el turno tomado.
  if (thread.botActive === false) {
    const marca = await prisma.inboxThread.findUnique({ where: { id: thread.id }, select: { botState: true } });
    if (!leerHandoff(marca?.botState)) return;
  }

  // ── Rate-limit del bot (anti-spam, anti-drenaje del wallet) ──
  // Por remitente (wa_id) y por clínica, ANTES de llamar a Claude. Al
  // excederse NO se responde (responder aquí permitiría spam de envíos
  // salientes); el mensaje ya quedó arriba en el Inbox para el staff.
  // ws1-t3 #20: en Upstash (global entre instancias), no en la memoria de
  // cada instancia serverless, que con varias instancias multiplicaba el tope.
  const senderAllowed = await persistentRateLimitKey(`wa-bot:${clinic.id}:${from}`, 6, 60);
  const clinicAllowed = await persistentRateLimitKey(`wa-bot-clinic:${clinic.id}`, 60, 60);
  if (!senderAllowed || !clinicAllowed) return;

  // ── Un turno del bot a la vez por hilo (ws1-t3 #11) ──
  // Sin esto, «hola» + «quiero cita» con un segundo de diferencia corrían dos
  // turnos en paralelo con el MISMO botState: dos respuestas y el estado del
  // último pisaba al del otro. El segundo webhook espera al primero y corre
  // con el estado ya guardado (lib/whatsapp/bot-turno.ts).
  const turno = await conTurnoDelHilo(thread.id, async () => {
    // Estado FRESCO del hilo: el turno anterior pudo cambiarlo mientras
    // esperábamos (agendado a medias, handoff…).
    const fresco = await prisma.inboxThread.findUnique({
      where: { id: thread.id },
      select: { botActive: true, botState: true },
    });
    if (!fresco) return;
    let botState = (fresco.botState ?? null) as Prisma.JsonValue | null;

    // Llegó otro mensaje de texto del paciente DESPUÉS de este: su turno lo
    // contesta con este dentro del historial. Contestar los dos sería
    // responder dos veces a una sola idea partida en dos mensajes.
    const masNuevo = await prisma.inboxMessage.findFirst({
      where: {
        threadId: thread.id,
        direction: "IN",
        isInternal: false,
        id: { not: inMsg.id },
        sentAt: { gt: now },
        attachments: { equals: Prisma.AnyNull },
      },
      select: { id: true },
    });
    if (masNuevo) return;

    // ── El staff tomó el control del hilo → el bot calla ──
    // botActive=false lo pone (a) el handoff del propio bot o (b) un echo de
    // coexistence / una respuesta desde el panel. ws1-t5 #4: la pausa de un
    // handoff del bot se levanta sola si nadie del equipo contestó en 12 h
    // (bot/handoff.ts); entonces el botState ya quedó limpio.
    if (fresco.botActive === false) {
      const reactivado = await reactivarBotSiVencioHandoff({ clinicId: clinic.id, threadId: thread.id, botState });
      if (!reactivado) return;
      botState = null;
    }

    // ── Tope diario de gasto del bot por clínica ──
    // Cuenta las respuestas OUT del bot de las últimas 24h. Al excederlo no se
    // llama a Claude: se avisa máximo una vez por hilo al día que atiende un
    // humano, y el resto queda en el Inbox.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const botRepliesToday = await prisma.inboxMessage.count({
      where: {
        thread: { clinicId: clinic.id },
        direction: "OUT",
        sentById: null,
        sentAt: { gte: dayAgo },
        // Los envíos automáticos de la plataforma (recordatorios, reseñas,
        // recetas, avisos…) también son OUT con sentById null, pero NO son
        // respuestas del bot y no gastan Claude: se excluyen por el prefijo
        // `sys:` de su externalId. Las respuestas del bot llevan `sys:bot:`
        // (ws1-t3 #7) y SÍ cuentan; las anteriores a ese cambio, externalId
        // null — un `NOT LIKE` en SQL descarta las filas NULL, de ahí el OR.
        OR: [
          { externalId: null },
          { externalId: { startsWith: BOT_REPLY_EXTERNAL_ID_PREFIX } },
          { NOT: { externalId: { startsWith: SYSTEM_EXTERNAL_ID_PREFIX } } },
        ],
      },
    });
    if (botRepliesToday >= BOT_DAILY_REPLY_CAP) {
      const alreadyNotified = await prisma.inboxMessage.findFirst({
        where: { threadId: thread.id, direction: "OUT", body: BOT_CAP_REACHED_MSG, sentAt: { gte: dayAgo } },
        select: { id: true },
      });
      if (!alreadyNotified) {
        await enviarYRegistrar({ clinic, threadId: thread.id, to: from, body: BOT_CAP_REACHED_MSG, origen: "bot" });
      }
      return;
    }

    // ── Bot híbrido configurable (FAQ + Claude + agenda) ──
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
      patient: patient ? { id: patient.id, phone: from, firstName: patient.firstName } : undefined,
      incomingText: rawText,
      history,
      botState,
    });

    // ws1-t3 #7: con su wamid (estados de Meta en el Inbox) y sin lanzar; si
    // Meta lo rechaza, el OUT queda FAILED con el código y se sigue guardando
    // el estado del bot.
    if (result.reply) {
      await enviarYRegistrar({ clinic, threadId: thread.id, to: from, body: result.reply, origen: "bot" });
    }

    // Persiste el estado multi-turno del bot y, si el bot deriva a humano
    // (handoff), PAUSA el bot en el hilo (botActive=false) para que no vuelva a
    // responder hasta que el staff lo reactive o venzan las 12 h (ws1-t5 #4).
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
    // ws1-t5 #4: nota interna para el equipo («el paciente espera respuesta»).
    if (result.handoff) await anotarHandoffEnInbox({ threadId: thread.id });
  });

  if (!turno.corrio) {
    console.warn(`[whatsapp/webhook] el bot no consiguió turno en el hilo ${thread.id}: el mensaje queda para el equipo`);
  }
}

/** «jueves, 2 de octubre» en la zona de la clínica. */
function fechaLargaDeCita(startsAt: Date, timezone: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone, weekday: "long", day: "numeric", month: "long",
  }).format(startsAt);
}

/**
 * ¿El bot va a atender un «quiero reagendar»? Encendido, con agenda y con el
 * hilo sin pausa. Si no, se le dice al paciente que el equipo le escribe.
 */
async function botPuedeAgendar(clinicId: string, botActive: boolean | null): Promise<boolean> {
  if (botActive === false) return false;
  try {
    const cfg = await prisma.whatsAppBotConfig.findUnique({
      where: { clinicId },
      select: { enabled: true, canBookAppointments: true },
    });
    return !!cfg?.enabled && !!cfg.canBookAppointments;
  } catch (e) {
    console.error("[whatsapp/webhook] no se pudo leer la config del bot:", e);
    return false;
  }
}

/**
 * Guarda lo que contestó el paciente en la fila del recordatorio.
 *
 * `close` es la decisión de fondo del arreglo: `repliedAt` significa "esta
 * respuesta CERRÓ el recordatorio", no "llegó algo". Solo lo cierra una
 * respuesta accionable (confirmar / cancelar) o una respuesta a un mensaje que
 * no pedía nada sobre la agenda (una encuesta). Un texto que no se entiende
 * guarda `patientReply` —para que el staff lo vea en el panel— pero deja
 * `repliedAt` en null: el recordatorio sigue vivo y el siguiente intento del
 * paciente, ya bien escrito, todavía puede confirmar la cita.
 *
 * Va en $executeRaw como el resto del flujo: whatsapp_reminders se creó y se
 * alteró a mano desde sql/, no con prisma migrate.
 */
async function recordReminderReply(
  id: string,
  text: string,
  opts: { close: boolean },
): Promise<void> {
  if (opts.close) {
    await prisma.$executeRaw`UPDATE whatsapp_reminders SET "patientReply"=${text}, "repliedAt"=NOW() WHERE id=${id}`;
    return;
  }
  await prisma.$executeRaw`UPDATE whatsapp_reminders SET "patientReply"=${text} WHERE id=${id}`;
}

/**
 * Manda UN aviso automático al paciente y lo registra en el Inbox, pero solo si
 * ese mismo texto no salió ya en este hilo desde `since`. Mismo patrón (dedupe
 * por cuerpo exacto) que el aviso del tope diario del bot.
 *
 * Devuelve true si lo mandó. false = ya estaba avisado o la clínica no tiene
 * credenciales de WhatsApp; en ambos casos el caller deja seguir el mensaje en
 * vez de quedarse atascado repitiendo —o callando— la misma frase.
 */
async function sendOnceToThread(args: {
  clinic: { id: string; waAccessToken: string | null; waPhoneNumberId: string | null };
  threadId: string;
  to: string;
  body: string;
  since: Date;
}): Promise<boolean> {
  const { waAccessToken, waPhoneNumberId } = args.clinic;
  if (!waAccessToken || !waPhoneNumberId) return false;
  try {
    const already = await prisma.inboxMessage.findFirst({
      where: {
        threadId:  args.threadId,
        direction: "OUT",
        body:      args.body,
        sentAt:    { gte: args.since },
      },
      select: { id: true },
    });
    if (already) return false;
  } catch (e) {
    // Si no se puede comprobar, mejor no mandar: repetirle la misma frase al
    // paciente en cada mensaje es peor que no decírsela dos veces.
    console.error("[whatsapp/webhook] no se pudo comprobar el aviso previo:", e);
    return false;
  }
  // true aunque Meta lo rechace: el intento quedó en el Inbox (FAILED) y
  // reintentarlo en este mismo mensaje fallaría igual.
  await enviarYRegistrar({ ...args, origen: "reminder" });
  return true;
}

/**
 * Manda texto libre al paciente y lo deja en el Inbox CON su wamid
 * (ws1-t3, auditoría del bot #7). Nunca lanza.
 *
 * - `origen: "bot"` → externalId `sys:bot:<wamid>`: cuenta para el tope diario
 *   y el Inbox lo pinta como siempre (etiqueta genérica).
 * - `origen: "reminder"` → `sys:reminder:<wamid>`: respuestas del flujo de
 *   recordatorios, FUERA del tope diario, como antes.
 *
 * Antes el bot guardaba su respuesta con externalId null —los estados de Meta
 * (entregado, leído, falló) no tenían a qué aplicarse— y un rechazo de Meta
 * lanzaba: no quedaba registro, no se guardaba el estado del bot y el fallo
 * solo existía en el log del servidor. Ahora el OUT queda con
 * deliveryStatus FAILED y el código de Meta (lo que el Inbox ya sabe pintar),
 * y un token revocado apaga la conexión, igual que en la cola.
 */
async function enviarYRegistrar(args: {
  clinic: { id: string; waAccessToken: string | null; waPhoneNumberId: string | null };
  threadId: string;
  to: string;
  body: string;
  origen: "bot" | "reminder";
}): Promise<boolean> {
  const { waAccessToken, waPhoneNumberId } = args.clinic;
  if (!waAccessToken || !waPhoneNumberId) return false;

  let wamid: string | null = null;
  let fallo: unknown = null;
  try {
    const meta = await sendWhatsAppMessage(waPhoneNumberId, waAccessToken, args.to, args.body);
    const id = meta?.messages?.[0]?.id;
    wamid = typeof id === "string" && id.length > 0 ? id : null;
  } catch (e) {
    fallo = e;
  }

  const codigo = fallo ? waErrorCode(fallo) : null;
  const motivo = fallo
    ? formatWaErrorMessage(codigo, (fallo as Error)?.message ?? "Meta rechazó el envío").slice(0, 500)
    : null;
  try {
    await prisma.inboxMessage.create({
      data: {
        threadId: args.threadId,
        direction: "OUT",
        body: args.body,
        sentAt: new Date(),
        externalId: args.origen === "bot" ? buildBotReplyExternalId(wamid) : buildSystemExternalId("reminder", wamid),
        ...(fallo ? { deliveryStatus: "FAILED", errorCode: codigo, errorTitle: motivo } : {}),
      },
    });
  } catch (e) {
    console.error("[whatsapp/webhook] no se pudo registrar la respuesta en el Inbox:", e);
  }

  if (!fallo) return true;
  console.error(`[whatsapp/webhook] Meta rechazó la respuesta (${args.origen}) en la clínica ${args.clinic.id}: ${motivo}`);
  if (isTokenRevoked(fallo)) {
    await markWhatsAppDisconnected(args.clinic.id, motivo ?? "sesión caducada");
  }
  return false;
}

/**
 * Estado de entrega REAL de lo que enviamos (M-06, M-10).
 *
 * Meta entrega estos avisos en `value.statuses[]`, repetidos y fuera de orden
 * (reintenta ante timeouts y 5xx). La decisión de si un status se aplica y qué
 * escribe vive en lib/whatsapp/delivery-status.ts —puro y testeado sin BD—, que
 * garantiza que un status repetido no cambie nada y que el estado NUNCA
 * retroceda (READ no vuelve a DELIVERED).
 *
 * Multi-tenant: todo se resuelve contra la clínica dueña del phone_number_id;
 * la búsqueda del mensaje va SIEMPRE acotada por `thread.clinicId`.
 */
async function ingestDeliveryStatuses(value: any): Promise<void> {
  const phoneNumberId = phoneNumberIdDe(value);
  const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
  if (!phoneNumberId || statuses.length === 0) return;

  const clinic = await prisma.clinic.findUnique({
    where: { waPhoneNumberId: phoneNumberId },
    select: { id: true },
  });
  if (!clinic) {
    // ── DaleControl Barber ─────────────────────────────────────────────
    // Mismo criterio que en el POST: el camino dental ya se resolvió y esto
    // solo corre cuando el número no es de ninguna clínica. En try/catch con
    // import dinámico para que nada de barber pueda afectar al dental.
    // Sin esto, un recordatorio de barbería RECHAZADO por Meta se quedaría
    // para siempre en "enviado" — el bug M-06/M-10 del dental.
    let handled = false;
    let barberFailed = false;
    try {
      const { applyBarberDeliveryStatuses } = await import("@/lib/barber/whatsapp");
      // applyBarberDeliveryStatuses YA devolvía boolean (false = el número no
      // es de ninguna barbería); antes se descartaba. Recogerlo no cambia
      // nada de lo que hace barber: solo permite encadenar el vertical
      // siguiente cuando el número no era suyo.
      handled = await applyBarberDeliveryStatuses(phoneNumberId, statuses);
    } catch (e) {
      barberFailed = true;
      console.error("[whatsapp/webhook] estados barber no aplicados:", e);
    }

    // ── DaleControl Inmuebles ──────────────────────────────────────────
    // Sin esto, un aviso de renta RECHAZADO por Meta se quedaría para
    // siempre en "enviado" — el bug M-06/M-10 del dental, otra vez.
    // `!barberFailed` por lo mismo que en el POST: si barber lanzó, no se
    // sabe de quién era el número y el vertical nuevo no corre.
    if (!handled && !barberFailed) {
      try {
        const { applyRealtyDeliveryStatuses } = await import("@/lib/realty/whatsapp");
        await applyRealtyDeliveryStatuses(phoneNumberId, statuses);
      } catch (e) {
        console.error("[whatsapp/webhook] estados inmuebles no aplicados:", e);
      }
    }
    return;
  }

  const now = new Date();
  let revokedReason: string | null = null;

  for (const st of statuses) {
    const wamid = typeof st?.id === "string" ? st.id : null;
    const raw   = typeof st?.status === "string" ? st.status : null;
    if (!wamid || !raw) continue;

    const err        = Array.isArray(st?.errors) ? st.errors[0] : null;
    const errorCode  = typeof err?.code === "number" ? err.code : null;
    const errorTitle = typeof err?.title === "string" ? err.title : null;

    const incoming = {
      raw,
      at: metaTimestampToDate(st?.timestamp, now),
      errorCode,
      errorTitle,
    };

    // El mismo wamid está guardado de dos formas según quién mandó el mensaje:
    // crudo (respuesta del staff desde el Inbox, ecos de coexistence) o dentro
    // de `sys:<kind>:<wamid>` (envíos automáticos — los recordatorios, que son
    // justo los que importan aquí). Se prueban las dos por igualdad EXACTA para
    // que la consulta use el índice de externalId: un `endsWith` recorrería la
    // tabla de mensajes entera en cada status que manda Meta.
    const candidates = [
      wamid,
      ...WHATSAPP_SEND_KINDS.map((k) => buildSystemExternalId(k, wamid)),
      // ws1-t3 #7: las respuestas del bot, `sys:bot:<wamid>`.
      buildBotReplyExternalId(wamid),
    ];

    try {
      const msg = await prisma.inboxMessage.findFirst({
        where: { externalId: { in: candidates }, thread: { clinicId: clinic.id } },
        select: { id: true, deliveryStatus: true },
      });

      if (msg) {
        const patch = applyDeliveryStatus(msg.deliveryStatus, incoming);
        // null = status desconocido, repetido, o que haría retroceder el
        // estado → no se escribe nada (idempotencia).
        if (patch) {
          await prisma.inboxMessage.update({ where: { id: msg.id }, data: patch });
        }
      }

      if (parseDeliveryStatus(raw) === "FAILED") {
        await markReminderFailedByWamid(clinic.id, wamid, errorCode, errorTitle);
        if (errorCode === WA_ERROR_CODE.TOKEN_EXPIRED) {
          revokedReason = formatWaErrorMessage(errorCode, errorTitle ?? "sesión caducada");
        }
      }
    } catch (e) {
      // Un status ilegible no puede tumbar los demás ni hacer que Meta
      // reintente el lote entero (el POST responde 200 igual).
      console.error("[whatsapp/webhook] status no aplicado:", e);
    }
  }

  // Token revocado: se apaga la conexión UNA vez por lote, no por status.
  // Seguir intentando con un token muerto es exactamente el "fallo mudo" que
  // esta auditoría persigue.
  if (revokedReason) {
    await markWhatsAppDisconnected(clinic.id, revokedReason);
  }
}

/**
 * Refleja en `WhatsAppReminder` un fallo que Meta reporta DESPUÉS de aceptar el
 * mensaje (131042 sin método de pago, 131026 número sin WhatsApp…). Sin esto la
 * fila se quedaba en SENT para siempre y el panel seguía diciendo que salió.
 *
 * El enlace es `payload.wamid`, que graba la cola al enviar: `WhatsAppReminder`
 * no tiene columna para el wamid y `payload` ya es Json libre.
 *
 * Acotado a `status: SENT` a propósito: un CANCELLED o un FAILED previo no se
 * reescriben. Best-effort — nunca tumba la ingesta del status.
 */
async function markReminderFailedByWamid(
  clinicId: string,
  wamid: string,
  code: number | null,
  title: string | null,
): Promise<void> {
  try {
    await prisma.whatsAppReminder.updateMany({
      where: {
        clinicId,
        status: WA_REMINDER_STATUS.SENT,
        payload: { path: ["wamid"], equals: wamid },
      },
      data: {
        status: WA_REMINDER_STATUS.FAILED,
        // El código va DENTRO del texto: la tabla no tiene columna para él y es
        // lo que lee el panel de recordatorios para traducir el motivo.
        errorMsg: formatWaErrorMessage(code, title ?? "Meta no pudo entregar el mensaje"),
      },
    });
  } catch (e) {
    console.error("[whatsapp/webhook] no se pudo marcar el recordatorio como fallido:", e);
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
  const phoneNumberId = phoneNumberIdDe(value);
  const echoes = Array.isArray(value?.message_echoes) ? value.message_echoes : [];
  if (!phoneNumberId || echoes.length === 0) return;

  const clinic = await prisma.clinic.findUnique({
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
