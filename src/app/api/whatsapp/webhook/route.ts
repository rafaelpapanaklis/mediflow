import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createHmac, timingSafeEqual } from "crypto";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { timeHHMMInTz } from "@/lib/agenda/legacy-helpers";
import { runBotTurn } from "@/lib/whatsapp/bot/engine";
import { actionablePatientIds, resolveReminderReply } from "@/lib/whatsapp/reminder-pick";
import {
  findPatientByWhatsAppPhone,
  findPatientsByWhatsAppPhone,
  upsertWhatsAppThread,
} from "@/lib/whatsapp/inbox-log";
import {
  SYSTEM_EXTERNAL_ID_PREFIX,
  buildSystemExternalId,
  WHATSAPP_SEND_KINDS,
} from "@/lib/whatsapp/system-message";
import {
  applyDeliveryStatus,
  metaTimestampToDate,
  parseDeliveryStatus,
} from "@/lib/whatsapp/delivery-status";
import { WA_ERROR_CODE, formatWaErrorMessage } from "@/lib/whatsapp/errors";
import { markWhatsAppDisconnected } from "@/lib/whatsapp/connection";
import { ingestTemplateStatusUpdate } from "@/lib/whatsapp/provision-templates";
import { cancelPendingRemindersForAppointment } from "@/lib/reminders/reschedule.server";
import { rateLimitKey } from "@/lib/rate-limit";
import type { BotHistoryItem } from "@/lib/whatsapp/bot/types";
import { Prisma } from "@prisma/client";
import { WA_REMINDER_STATUS } from "@/lib/whatsapp/reminder-status";

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

    // ── Meta revisó una plantilla ────────────────────────────────────────────
    //    Aquí llega el APPROVED / REJECTED de las plantillas que DaleControl da
    //    de alta en la WABA de cada clínica. Sin esto quedarían "en revisión"
    //    para siempre y con ellas los recordatorios apagados.
    //    OJO: este aviso NO trae `metadata.phone_number_id`; el `entry[].id` ES
    //    el WABA id, así que la clínica se resuelve por `waBusinessAccountId`.
    //    (Requiere tener suscrito el campo `message_template_status_update` en
    //    la app de Meta; el cron de respaldo cubre lo que se pierda.)
    if (changes?.field === "message_template_status_update") {
      await ingestTemplateStatusUpdate(entry?.id, value);
      return NextResponse.json({ ok: true });
    }

    // ── Estado de entrega REAL (M-06, M-10) ──────────────────────────────────
    //    Meta reporta aquí qué pasó con CADA mensaje que mandamos nosotros:
    //    sent → delivered → read, o failed con el código del motivo. El webhook
    //    no lo miraba, así que la doble palomita del Inbox mentía siempre y el
    //    panel daba por "Enviado" lo que Meta había rechazado.
    //    Va ANTES del early-return de `messages`: un payload de status no trae
    //    `messages` y hasta hoy salía por ahí sin que nadie lo leyera.
    if (Array.isArray(value?.statuses) && value.statuses.length > 0) {
      await ingestDeliveryStatuses(value);
      // Sin `return`: Meta manda statuses y messages en llamadas distintas,
      // pero si algún día vinieran juntos el mensaje entrante no se perdería.
    }

    const messages = value?.messages;

    if (!messages?.length) return NextResponse.json({ ok: true });

    const msg     = messages[0];
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

    if (!from) return NextResponse.json({ ok: true });

    // Lo que NO es texto (foto, nota de voz, PDF, ubicación…) antes se tiraba
    // aquí en silencio: la paciente mandaba la foto de su muela y el Inbox no se
    // enteraba de que existió. Ahora se describe en una frase y sus adjuntos
    // viajan en `attachments`; solo se sale si no hay ni texto ni nada que contar.
    const incoming = rawText ? null : describeIncoming(msg);
    if (!rawText && !incoming) return NextResponse.json({ ok: true });

    // Resuelve la clínica por el phone_number_id de WhatsApp.
    const phoneNumberId = value?.metadata?.phone_number_id;
    const clinic = await prisma.clinic.findFirst({
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
      return NextResponse.json({ ok: true });
    }

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
        return NextResponse.json({ ok: true });
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
      return NextResponse.json({ ok: true });
    }

    // ── CONSERVA el flujo de confirmar/cancelar recordatorios ──
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
    // (lib/whatsapp/reminder-pick.ts, npm run test:wa-reminder-pick):
    // - Accionable = el que PIDE confirmar/cancelar (APPT_AUTO, APPOINTMENT
    //   legacy o MANUAL) Y cuya cita sigue viva. Sin ese filtro, contestar la
    //   encuesta de seguimiento (FOLLOWUP) reabría o cancelaba una cita ya
    //   atendida —probablemente facturada— y el paciente recibía "❌ Tu cita ha
    //   sido cancelada" justo después de opinar.
    // - Si no hay accionable, la respuesta se registra sobre el más reciente
    //   pero con acción "none": no se toca ninguna cita.
    // - CANCELAR además exige que el accionable sea el mensaje MÁS RECIENTE:
    //   "no tuve dolor" contestado a una encuesta clasifica como cancelar por
    //   el "no", y no puede llevarse por delante la cita de la semana que viene.
    // - Cancelar se evalúa PRIMERO para frases ambiguas ("mejor no, sí
    //   cancélala"); "1"/"2" solo por igualdad exacta (text ya viene trimmed).
    // - `unclear` = el mensaje SÍ le pedía confirmar/cancelar y no se entendió
    //   la respuesta. Ese caso ya no quema el recordatorio (ver abajo).
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
      if (notified) return NextResponse.json({ ok: true });
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

        if (clinic.waAccessToken && clinic.waPhoneNumberId) {
          const body = `❌ Tu cita ha sido *cancelada*. Si deseas reagendar, comunícate con nosotros. ¡Hasta pronto!`;
          await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from, body);
          await logAutoReply(thread.id, body);
        }
        return NextResponse.json({ ok: true });
      } else if (reply === "confirm") {
        await prisma.appointment.update({
          where: { id: reminder.appointmentId },
          data:  { status: "CONFIRMED", confirmedAt: new Date() },
        });
        await recordReminderReply(reminder.id, text, { close: true });

        if (clinic.waAccessToken && clinic.waPhoneNumberId) {
          const appt = reminder.appointment;
          const dateStr = new Intl.DateTimeFormat("es-MX", {
            timeZone: clinic.timezone, weekday: "long", day: "numeric", month: "long",
          }).format(appt.startsAt);
          const body = `✅ ¡Perfecto! Tu cita del ${dateStr} a las ${timeHHMMInTz(appt.startsAt, clinic.timezone)} está *confirmada*. Te esperamos. 😊`;
          await sendWhatsAppMessage(clinic.waPhoneNumberId, clinic.waAccessToken, from, body);
          await logAutoReply(thread.id, body);
        }
        return NextResponse.json({ ok: true });
      } else if (unclear) {
        // ── Un dedazo NO puede inutilizar la confirmación ──
        // El mensaje SÍ le pedía CONFIRMAR/CANCELAR y contestó algo que no
        // entendemos ("Confirmarr", "el jueves mejor", "ok gracias"). Antes esto
        // escribía `repliedAt` igual que una confirmación: el recordatorio se
        // quemaba, `pendingReminders` volvía vacío y los tres intentos correctos
        // que venían detrás ya no encontraban nada que confirmar.
        //
        // Criterio nuevo: `repliedAt` significa "esta respuesta CERRÓ el
        // recordatorio", y solo la cierra algo accionable. El texto sí se guarda
        // en `patientReply` —el staff lo ve— pero la puerta queda abierta: el
        // siguiente "Confirmar" bien escrito confirma la cita.
        await recordReminderReply(reminder.id, text, { close: false });
        const asked = await sendOnceToThread({
          clinic,
          threadId: thread.id,
          to: from,
          body: REMINDER_UNCLEAR_MSG,
          // Una sola aclaración por recordatorio, no por mensaje.
          since: reminder.sentAt ?? dayAgo,
        });
        if (asked) return NextResponse.json({ ok: true });
        // Ya se le pidió aclarar y sigue sin decir confirmar ni cancelar: no es
        // un dedazo, es otra conversación. Se deja pasar al bot / al staff en
        // vez de repetirle la misma frase — o de callar, que era lo de antes.
        // El recordatorio sigue abierto: si más tarde escribe CONFIRMAR, entra
        // por la rama de arriba y la cita se confirma.
      } else {
        // Respuesta a una encuesta o a un aviso que no pedía nada sobre la
        // agenda: se registra y se cierra, como siempre.
        await recordReminderReply(reminder.id, text, { close: true });
        return NextResponse.json({ ok: true });
      }
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
    // (`dayAgo` se calculó arriba, junto al flujo de recordatorios.)
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
  clinic: { waAccessToken: string | null; waPhoneNumberId: string | null };
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
  await sendWhatsAppMessage(waPhoneNumberId, waAccessToken, args.to, args.body);
  await logAutoReply(args.threadId, args.body);
  return true;
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
  const phoneNumberId = value?.metadata?.phone_number_id;
  const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
  if (!phoneNumberId || statuses.length === 0) return;

  const clinic = await prisma.clinic.findFirst({
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
