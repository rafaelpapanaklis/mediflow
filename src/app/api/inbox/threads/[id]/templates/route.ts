// GET/POST /api/inbox/threads/[id]/templates — plantillas APROBADAS de Meta
// desde el composer del Inbox, EN UN HILO QUE YA EXISTE.
//
// EL FALLO QUE CIERRA: los chips de "plantilla" del Inbox pegaban TEXTO LIBRE en
// el recuadro. Fuera de la ventana de 24 h de WhatsApp ese texto no le llega a
// nadie —Meta lo rechaza con 131047— y el panel lo pintaba como enviado: nunca
// se había mandado una plantilla aprobada desde el Inbox.
//
//   GET  → qué plantillas del catálogo se pueden enviar HOY a este hilo, ya
//          rellenadas con los datos REALES del paciente (su próxima cita, su
//          saldo) y con el motivo en español de las que no.
//   POST → las envía. El servidor RECALCULA los valores de {{1}}…{{n}}: si los
//          aceptara del body, cualquiera podría dictar el texto que Meta entrega
//          al paciente con el sello de la clínica.
//
// Quién arma esas opciones y con qué datos vive en lib/inbox/template-offer:
// lo comparte con /api/inbox/compose, que hace lo mismo cuando TODAVÍA NO HAY
// HILO (iniciar la conversación con un paciente que nunca ha escrito).
//
// Quien decide texto libre vs. plantilla es `sendWhatsAppLogged` (una sola
// fuente para todo el producto): dentro de la ventana manda el texto —gratis— y
// fuera manda la plantilla de verdad, además de registrar el mensaje en el hilo.
//
// Multi-tenant: clinicId SIEMPRE de getAuthContext; el hilo se busca acotado a
// esa clínica y las credenciales de WhatsApp son las de ESA clínica.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getAuthContext } from "@/lib/auth-context";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import {
  assertPatientVisible,
  patientVisibilityAnd,
  type VisibilityViewer,
} from "@/lib/patient-visibility";
import { isWithin24hWindow } from "@/lib/inbox/send-core";
import { describeNoTemplatesAvailable } from "@/lib/inbox/composer-templates";
import {
  TEMPLATES_MANAGE_HREF,
  TEMPLATE_CLINIC_SELECT,
  buildTemplateOffering,
  describeMetaError,
  describeWhatsAppNotReady,
  kindsForSession,
  templateDisplayName,
  type TemplatePatient,
} from "@/lib/inbox/template-offer";
import { findPatientByWhatsAppPhone } from "@/lib/whatsapp/inbox-log";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import { WhatsAppApiError, WhatsAppBlockedError, waErrorCode } from "@/lib/whatsapp/errors";
import type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";

export const dynamic = "force-dynamic";

interface Params {
  params: { id: string };
}

const PostSchema = z.object({ kind: z.string().min(1).max(40) });

// ─────────────────────────── carga del hilo ───────────────────────────

// Solo las columnas necesarias de Clinic: la fila entera lleva secretos
// (tokens, llaves de Facturapi) y de aquí sale JSON al navegador. waAccessToken
// se carga para PODER enviar, nunca para responderlo.
const THREAD_SELECT = {
  id: true,
  channel: true,
  externalId: true,
  patientId: true,
  patient: { select: { id: true, firstName: true, lastName: true, phone: true } },
  clinic: { select: TEMPLATE_CLINIC_SELECT },
} as const;

function loadThread(id: string, clinicId: string) {
  // El clinicId va en el where (no se comprueba después): un hilo de otra
  // clínica debe ser un 404, no un 403 que confirme que existe.
  return prisma.inboxThread.findFirst({ where: { id, clinicId }, select: THREAD_SELECT });
}

type ThreadRow = Awaited<ReturnType<typeof loadThread>>;

/** Paciente del hilo — el enlazado o, si el hilo es huérfano, el del teléfono. */
async function resolveThreadPatient(
  thread: NonNullable<ThreadRow>,
  viewer: VisibilityViewer,
): Promise<TemplatePatient | null> {
  // El enlazado ya pasó por assertPatientVisible en el handler.
  if (thread.patient) return thread.patient;

  const phone = (thread.externalId ?? "").trim();
  if (!phone) return null;
  const match = await findPatientByWhatsAppPhone(viewer.clinicId, phone);
  if (!match) return null;

  // Un hilo SIN patientId no pasa por el gate de visibilidad del handler (no hay
  // id que comprobar), así que la visibilidad se aplica AQUÍ: si el paciente
  // está restringido para este usuario simplemente no se resuelve —la plantilla
  // se ofrece sin sus datos— en vez de filtrarle el nombre por la puerta de
  // atrás. Consulta permitida por la regla de patient-visibility porque lleva el
  // filtro del viewer.
  return prisma.patient.findFirst({
    where: { id: match.id, clinicId: viewer.clinicId, AND: patientVisibilityAnd(viewer) },
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
}

// ═══════════════════════════════ GET ═══════════════════════════════

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const denied = denyIfMissingPermission(ctx, "inbox.view");
    if (denied) return denied;

    const viewer: VisibilityViewer = {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    };

    const thread = await loadThread(params.id, ctx.clinicId);
    if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Las plantillas llevan el nombre, la cita y el saldo del paciente: mismo
    // gate de visibilidad que la conversación (hilos sin paciente siguen).
    if (thread.patientId) {
      const deniedPatient = await assertPatientVisible(thread.patientId, viewer);
      if (deniedPatient) return deniedPatient;
    }

    const clinic = thread.clinic;
    const waConnected = Boolean(clinic?.waConnected);
    const billingOk = Boolean(clinic?.waBillingOk);

    // Un hilo de correo o del portal no tiene a dónde mandar una plantilla de
    // WhatsApp: su externalId es un Message-ID, no un teléfono. Se responde el
    // contrato completo (el composer no necesita otro camino) con la lista
    // vacía y el motivo.
    if (thread.channel !== "WHATSAPP") {
      return NextResponse.json({
        windowOpen: false,
        waConnected,
        billingOk,
        patientName: null,
        options: [],
        unavailableReason: "Las plantillas de WhatsApp solo se pueden enviar en un chat de WhatsApp.",
        manageHref: TEMPLATES_MANAGE_HREF,
      });
    }

    const now = new Date();
    const lastIn = await prisma.inboxMessage.findFirst({
      where: { threadId: thread.id, direction: "IN" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    // Solo informativo para el composer: quien decide de verdad al enviar es
    // sendWhatsAppLogged, que mide la ventana contra el teléfono (no el hilo).
    const windowOpen = isWithin24hWindow(lastIn?.sentAt ?? null, now);

    // Mismo gate que protege el saldo en el resto del producto.
    const canSeeBilling = !denyIfMissingPermission(ctx, "billing.view");

    const patient = await resolveThreadPatient(thread, viewer);
    const { options } = await buildTemplateOffering({
      clinicId: ctx.clinicId,
      clinic: clinic!,
      patient,
      canSeeBilling,
      now,
    });

    return NextResponse.json({
      windowOpen,
      waConnected,
      billingOk,
      patientName: templateDisplayName(patient),
      options,
      unavailableReason: describeNoTemplatesAvailable({ options, waConnected, billingOk }),
      manageHref: TEMPLATES_MANAGE_HREF,
    });
  } catch (err) {
    console.error("[GET inbox/threads/:id/templates]", err);
    return NextResponse.json({ error: "No se pudieron cargar las plantillas." }, { status: 500 });
  }
}

// ═══════════════════════════════ POST ═══════════════════════════════

export async function POST(req: NextRequest, { params }: Params) {
  // Cada plantilla se la cobra Meta a la clínica: un botón que se dispara solo
  // (doble clic, reintento del cliente) le cuesta dinero de verdad.
  const limited = rateLimit(req, 20);
  if (limited) return limited;

  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const denied = denyIfMissingPermission(ctx, "inbox.send");
    if (denied) return denied;

    const raw = await req.json().catch(() => null);
    const parsed = PostSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Falta indicar qué plantilla enviar." }, { status: 400 });
    }
    const kind = parsed.data.kind as WhatsAppSendKind;
    // Allowlist: solo los tipos que el composer sabe rellenar (las demás del
    // catálogo cuelgan de un documento —receta, presupuesto, consentimiento— y
    // se mandan desde su propia pantalla) Y que ESTA sesión puede ofrecer: sin
    // "billing.view" el aviso de saldo no se envía, porque su cuerpo lleva el
    // importe. Se comprueba también aquí, no solo en el GET: la lista de chips
    // la pinta el cliente, y el cliente no es quien decide los permisos.
    const canSeeBilling = !denyIfMissingPermission(ctx, "billing.view");
    if (!(kindsForSession(canSeeBilling) as readonly string[]).includes(kind)) {
      return NextResponse.json(
        { error: "Esa plantilla no se puede enviar desde el chat." },
        { status: 400 },
      );
    }

    const viewer: VisibilityViewer = {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    };

    const thread = await loadThread(params.id, ctx.clinicId);
    if (!thread) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (thread.patientId) {
      const deniedPatient = await assertPatientVisible(thread.patientId, viewer);
      if (deniedPatient) return deniedPatient;
    }

    if (thread.channel !== "WHATSAPP") {
      return NextResponse.json(
        { error: "Las plantillas de WhatsApp solo se pueden enviar en un chat de WhatsApp." },
        { status: 400 },
      );
    }

    const clinic = thread.clinic;
    // sendWhatsAppLogged NO filtra por waConnected (sus callers ya lo hacen):
    // sin este gate el envío iría a Meta con credenciales vacías y volvería un
    // error opaco en vez de decir qué hay que conectar.
    const notReady = clinic ? describeWhatsAppNotReady(clinic) : "WhatsApp no está conectado en esta clínica.";
    if (!clinic || notReady) {
      return NextResponse.json({ error: notReady }, { status: 409 });
    }

    const now = new Date();
    const patient = await resolveThreadPatient(thread, viewer);
    // Los params se RECALCULAN aquí, nunca llegan del body: son el texto que
    // Meta le entrega al paciente firmado por la clínica.
    const { byKind } = await buildTemplateOffering({
      clinicId: ctx.clinicId,
      clinic,
      patient,
      canSeeBilling,
      now,
    });
    const built = byKind.get(kind);
    if (!built) {
      return NextResponse.json({ error: "Esa plantilla ya no existe." }, { status: 400 });
    }
    if (built.option.blockedReason) {
      // No se llama a Meta: el mensaje no llegaría y encima parecería enviado.
      return NextResponse.json({ error: built.option.blockedReason }, { status: 409 });
    }
    // buildInboxTemplateOption garantiza el preview cuando no hay blockedReason.
    const preview = built.option.preview ?? "";

    // MANDA EL NÚMERO DEL HILO, no el de la ficha.
    //
    // Es un chat: el mensaje tiene que salir al número con el que ESTA
    // conversación existe. Si la ficha se corrigió después con otro teléfono y
    // preferimos ese, pasan dos cosas malas a la vez — la plantilla se le manda
    // a un número distinto del que está leyendo el paciente, y el registro cae
    // en OTRO hilo (send-and-log agrupa por los últimos 10 dígitos del destino),
    // así que quien pulsó ve el toast de "enviado" y el mensaje no aparece nunca
    // en la conversación que tenía delante.
    // `||` y no `??`: un externalId vacío no debe ganarle al teléfono de la ficha.
    const to = (thread.externalId ?? "").trim() || (thread.patient?.phone ?? "").trim();
    if (!to) {
      return NextResponse.json(
        { error: "Este hilo no tiene un teléfono al que escribir." },
        { status: 400 },
      );
    }

    try {
      // Dentro de la ventana de 24 h sale `preview` como texto libre (gratis);
      // fuera sale la PLANTILLA con estos params. El helper además registra el
      // mensaje en el hilo, marca waBillingOk ante el 131042 y lanza
      // WhatsAppBlockedError con el motivo ya en español.
      await sendWhatsAppLogged({
        clinic: {
          id: clinic.id,
          waPhoneNumberId: clinic.waPhoneNumberId,
          waAccessToken: clinic.waAccessToken,
          waConnected: clinic.waConnected,
          waTemplates: clinic.waTemplates,
        },
        to,
        body: preview,
        kind,
        templateParams: built.params,
        // Esta plantilla la mandó una PERSONA: el hilo la muestra con su nombre,
        // no con la etiqueta de envío automático.
        sentById: ctx.userId,
      });
    } catch (e) {
      if (e instanceof WhatsAppBlockedError) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      if (e instanceof WhatsAppApiError) {
        // El error crudo (con su código) queda en el log para diagnóstico; al
        // panel va la traducción.
        console.error(`[POST inbox/threads/:id/templates] Meta rechazó ${kind} (hilo ${thread.id}):`, e);
        return NextResponse.json({ error: describeMetaError(waErrorCode(e)) }, { status: 502 });
      }
      console.error(`[POST inbox/threads/:id/templates] fallo al enviar ${kind} (hilo ${thread.id}):`, e);
      return NextResponse.json({ error: "No se pudo enviar la plantilla." }, { status: 502 });
    }

    // El InboxMessage ya lo creó sendWhatsAppLogged (crear otro aquí duplicaría
    // el mensaje en el hilo). Lo único que falta es lo que el helper NO hace,
    // porque él sirve a los envíos automáticos: pausar el bot. Esta plantilla la
    // mandó una PERSONA, así que el bot no debe pisar la conversación.
    //
    // Best-effort: el mensaje YA salió y fallar aquí lo daría por no enviado.
    try {
      await prisma.inboxThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date(), botActive: false },
      });
    } catch (e) {
      console.error(`[POST inbox/threads/:id/templates] no se pudo pausar el bot (${thread.id}):`, e);
    }

    return NextResponse.json({ ok: true, body: preview }, { status: 201 });
  } catch (err) {
    console.error("[POST inbox/threads/:id/templates]", err);
    return NextResponse.json({ error: "No se pudo enviar la plantilla." }, { status: 500 });
  }
}
