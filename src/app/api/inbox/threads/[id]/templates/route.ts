// GET/POST /api/inbox/threads/[id]/templates — plantillas APROBADAS de Meta
// desde el composer del Inbox.
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
import {
  INBOX_COMPOSER_KINDS,
  buildInboxTemplateOption,
  describeNoTemplatesAvailable,
  type InboxTemplateOption,
} from "@/lib/inbox/composer-templates";
import { catalogEntryFor } from "@/lib/whatsapp/templates-catalog";
import { parseWaTemplates, type WaTemplateMap } from "@/lib/whatsapp/template-config";
import { findPatientByWhatsAppPhone } from "@/lib/whatsapp/inbox-log";
import { sendWhatsAppLogged } from "@/lib/whatsapp/send-and-log";
import {
  WA_ERROR_CODE,
  WhatsAppApiError,
  WhatsAppBlockedError,
  waErrorCode,
} from "@/lib/whatsapp/errors";
import type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";

export const dynamic = "force-dynamic";

/** Dónde se dan de alta las plantillas (lo abre el enlace del composer). */
const MANAGE_HREF = "/dashboard/whatsapp/plantillas";

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
  clinic: {
    select: {
      id: true,
      name: true,
      phone: true,
      timezone: true,
      waConnected: true,
      waPhoneNumberId: true,
      waAccessToken: true,
      waTemplates: true,
      waBillingOk: true,
    },
  },
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
): Promise<{ id: string; firstName: string; lastName: string; phone: string | null } | null> {
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

// ─────────────────── datos con los que se rellenan las plantillas ───────────────────

interface ApptFact {
  startsAt: Date;
  doctor: { firstName: string; lastName: string } | null;
}

interface TemplateFacts {
  clinicName: string;
  /** Teléfono de la clínica: {{4}} de dc_aviso_saldo. Vacío = falta capturarlo. */
  clinicPhone: string;
  timezone: string;
  /** {{1}} de todas las plantillas. NUNCA vacío: Meta rechaza las variables vacías. */
  patientName: string;
  hasPatient: boolean;
  /** Próxima cita (la más cercana en el futuro). */
  upcoming: ApptFact | null;
  /** La más reciente ya pasada — solo la usa el genérico `manual_api`. */
  lastPast: ApptFact | null;
  /** Saldo pendiente del paciente, sin canceladas ni borradores. */
  balance: number;
}

const APPT_SELECT = {
  startsAt: true,
  doctor: { select: { firstName: true, lastName: true } },
} as const;

/**
 * Las consultas de citas y saldo se hacen UNA vez y se reparten entre los cinco
 * tipos de plantilla: una por tipo serían quince viajes a la BD cada vez que se
 * abre el composer.
 */
async function loadTemplateFacts(args: {
  clinicId: string;
  clinicName: string;
  clinicPhone: string | null;
  timezone: string;
  patient: { firstName: string; lastName: string } | null;
  patientId: string | null;
  now: Date;
  /**
   * ¿La sesión tiene "billing.view"? Sin el permiso ni se consulta el saldo:
   * el aviso de saldo lleva el importe DENTRO del texto de la plantilla, así
   * que devolverlo aquí filtraría por la puerta de atrás el dato que el resto
   * del producto protege con ese permiso (la ficha ni monta el card).
   */
  canSeeBilling: boolean;
}): Promise<TemplateFacts> {
  const base: TemplateFacts = {
    clinicName: (args.clinicName ?? "").trim() || "tu clínica",
    clinicPhone: (args.clinicPhone ?? "").trim(),
    timezone: args.timezone || "America/Mexico_City",
    // Solo el nombre de pila, igual que la cola de recordatorios: es como se
    // saluda en WhatsApp y evita el "Hola " a secas si el apellido falta.
    patientName: (args.patient?.firstName ?? "").trim() || "paciente",
    hasPatient: Boolean(args.patientId),
    upcoming: null,
    lastPast: null,
    balance: 0,
  };
  if (!args.patientId) return base;

  const [upcoming, lastPast, debt] = await Promise.all([
    prisma.appointment.findFirst({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        startsAt: { gte: args.now },
        // Una cita cancelada o a la que no vino no es "su próxima cita".
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      orderBy: { startsAt: "asc" },
      select: APPT_SELECT,
    }),
    prisma.appointment.findFirst({
      where: {
        clinicId: args.clinicId,
        patientId: args.patientId,
        startsAt: { lt: args.now },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      orderBy: { startsAt: "desc" },
      select: APPT_SELECT,
    }),
    // Saldo pendiente. Las CANCELADAS quedan fuera SIEMPRE: cancelar una factura
    // solo cambia su status y le DEJA el balance intacto, así que sumarlas le
    // cobraría al paciente dinero que la clínica ya anuló. Los DRAFT tampoco:
    // un borrador no es un saldo exigible (mismo criterio que el aviso de saldo
    // de /api/invoices/[id]/send-whatsapp).
    args.canSeeBilling
      ? prisma.invoice.aggregate({
          where: {
            clinicId: args.clinicId,
            patientId: args.patientId,
            balance: { gt: 0 },
            status: { notIn: ["DRAFT", "CANCELLED"] },
          },
          _sum: { balance: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    ...base,
    upcoming: upcoming ?? null,
    lastPast: lastPast ?? null,
    balance: debt?._sum?.balance ?? 0,
  };
}

// ─────────────────────────── formato de las variables ───────────────────────────

// Fecha y hora SIEMPRE en la zona de la clínica y con el MISMO formato que la
// cola de recordatorios: si el mismo paciente recibe "lunes 11 de agosto" del
// cron y otra cosa desde el Inbox, parecen dos citas distintas.
function fmtDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

function fmtTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** Mismo formato que el aviso de saldo de facturación: "$1,200.00 MXN". */
function fmtMXN(n: number): string {
  const v = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
  return `${v} MXN`;
}

/** Meta rechaza las variables vacías: sin doctor en la cita va la fórmula genérica. */
function fmtDoctor(appt: ApptFact): string {
  if (!appt.doctor) return "tu doctor(a)";
  const name = `${appt.doctor.firstName ?? ""} ${appt.doctor.lastName ?? ""}`.trim();
  return name ? `Dr/a. ${name}` : "tu doctor(a)";
}

// Motivos EN ESPAÑOL de por qué falta el dato. Se leen en el panel, así que
// dicen qué hacer, no qué falló.
const REASON_NO_PATIENT =
  "Este chat todavía no está ligado a ningún paciente, así que no hay datos con los que rellenar la plantilla.";
const REASON_NO_APPOINTMENT =
  "Este paciente no tiene ninguna cita registrada, y la plantilla anuncia una fecha.";
const REASON_NO_UPCOMING = "El paciente no tiene ninguna cita próxima que recordarle.";
const REASON_NO_BALANCE = "Este paciente no tiene saldo pendiente.";
const REASON_NO_CLINIC_PHONE =
  "Falta el teléfono de la clínica: regístralo en Configuración → Clínica.";

interface KindParams {
  /** Valores de {{1}}…{{n}} EN ORDEN, o null si no se pudieron armar. */
  params: string[] | null;
  missingDataReason: string | null;
}

/**
 * Valores de las variables de cada plantilla, en el ORDEN POSICIONAL del
 * catálogo (Meta sustituye por posición, no por nombre: cambiar el orden aquí
 * entrega el mensaje con los datos cambiados de sitio).
 *
 * Es la MISMA función para el GET y para el POST a propósito: lo que se
 * previsualiza y lo que se envía no pueden divergir.
 */
function paramsForKind(kind: WhatsAppSendKind, f: TemplateFacts): KindParams {
  if (kind === "review") {
    // {{1}} paciente · {{2}} clínica — siempre rellenable.
    return { params: [f.patientName, f.clinicName], missingDataReason: null };
  }

  if (!f.hasPatient) {
    return { params: null, missingDataReason: REASON_NO_PATIENT };
  }

  if (kind === "manual_api") {
    // {{1}} paciente · {{2}} clínica · {{3}} fecha · {{4}} hora.
    // El genérico habla de "tu cita del …": vale la próxima y, si no hay
    // ninguna futura, la última que sí ocurrió.
    const appt = f.upcoming ?? f.lastPast;
    if (!appt) return { params: null, missingDataReason: REASON_NO_APPOINTMENT };
    return {
      params: [
        f.patientName,
        f.clinicName,
        fmtDate(appt.startsAt, f.timezone),
        fmtTime(appt.startsAt, f.timezone),
      ],
      missingDataReason: null,
    };
  }

  if (kind === "reminder" || kind === "booking") {
    // {{1}} paciente · {{2}} clínica · {{3}} fecha · {{4}} hora · {{5}} doctor.
    // SOLO con cita futura: recordar o confirmar una cita que ya pasó es peor
    // que no mandar nada.
    const appt = f.upcoming;
    if (!appt) return { params: null, missingDataReason: REASON_NO_UPCOMING };
    return {
      params: [
        f.patientName,
        f.clinicName,
        fmtDate(appt.startsAt, f.timezone),
        fmtTime(appt.startsAt, f.timezone),
        fmtDoctor(appt),
      ],
      missingDataReason: null,
    };
  }

  if (kind === "payment_notice") {
    // {{1}} paciente · {{2}} clínica · {{3}} monto · {{4}} teléfono de la clínica.
    if (!(f.balance > 0)) return { params: null, missingDataReason: REASON_NO_BALANCE };
    // No hay pago en línea: el aviso dirige a pagar EN la clínica o por
    // teléfono, así que sin teléfono el mensaje no lleva a ninguna parte.
    if (!f.clinicPhone) return { params: null, missingDataReason: REASON_NO_CLINIC_PHONE };
    return {
      params: [f.patientName, f.clinicName, fmtMXN(f.balance), f.clinicPhone],
      missingDataReason: null,
    };
  }

  // Tipo fuera de INBOX_COMPOSER_KINDS: no se ofrece.
  return { params: null, missingDataReason: REASON_NO_PATIENT };
}

/** La opción tal como la ve el composer, JUNTO con los params que la rellenan. */
function buildOne(
  kind: WhatsAppSendKind,
  facts: TemplateFacts,
  templates: WaTemplateMap,
): { option: InboxTemplateOption; params: string[] | null } | null {
  const entry = catalogEntryFor(kind);
  // Sin entrada en el catálogo no hay cuerpo que enviar ni que previsualizar.
  if (!entry) return null;
  const { params, missingDataReason } = paramsForKind(kind, facts);
  return {
    option: buildInboxTemplateOption({ entry, cfg: templates[kind] ?? null, params, missingDataReason }),
    params,
  };
}

/**
 * Los tipos que ESTA sesión puede ofrecer.
 *
 * "payment_notice" queda fuera sin "billing.view": su plantilla lleva el saldo
 * pendiente DENTRO del cuerpo, así que ofrecerla con el preview relleno le
 * enseñaría el importe a quien el resto del producto se lo esconde (la ficha ni
 * monta el card de Estado de cuenta sin ese permiso). No se "tapa" el monto: se
 * quita la opción entera, porque una plantilla que no se puede rellenar sin ver
 * el dato no es una plantilla que esa persona pueda mandar.
 */
function kindsFor(canSeeBilling: boolean): readonly WhatsAppSendKind[] {
  if (canSeeBilling) return INBOX_COMPOSER_KINDS;
  return INBOX_COMPOSER_KINDS.filter((k) => k !== "payment_notice");
}

/** Nombre completo para el encabezado del composer ("Se enviará a …"). */
function displayName(p: { firstName: string; lastName: string } | null): string | null {
  if (!p) return null;
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return name || null;
}

/**
 * Error de Meta → español, POR CÓDIGO. El texto de Meta cambia de redacción y
 * viene en inglés; el número es el único dato estable. Nunca se le enseña el
 * error crudo a la clínica.
 */
function describeMetaError(code: number | null): string {
  if (code === WA_ERROR_CODE.BILLING_REQUIRED) {
    return (
      "La cuenta de WhatsApp de la clínica no tiene método de pago en Meta. " +
      "Meta cobra cada plantilla: agrega una tarjeta en Meta Business para poder enviarlas."
    );
  }
  if (code === WA_ERROR_CODE.TEMPLATE_PARAMS_MISMATCH) {
    return (
      "Los datos de la plantilla no coinciden con la que Meta aprobó. " +
      "Vuelve a crearla en Configuración → WhatsApp → Plantillas."
    );
  }
  if (code === WA_ERROR_CODE.TEMPLATE_NOT_FOUND) {
    return (
      "Meta no encuentra esta plantilla aprobada en la cuenta de la clínica. " +
      "Créala en Configuración → WhatsApp → Plantillas."
    );
  }
  if (code === WA_ERROR_CODE.OUTSIDE_24H) {
    return "Fuera de la ventana de 24 h WhatsApp solo entrega plantillas aprobadas.";
  }
  if (code === WA_ERROR_CODE.UNDELIVERABLE) {
    return "Ese número no tiene WhatsApp o no puede recibir mensajes.";
  }
  if (code === WA_ERROR_CODE.TOKEN_EXPIRED) {
    return "La conexión con WhatsApp caducó. Vuelve a conectarla en Configuración → WhatsApp.";
  }
  return "WhatsApp no pudo entregar el mensaje. Inténtalo de nuevo en unos minutos.";
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
        manageHref: MANAGE_HREF,
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
    const facts = await loadTemplateFacts({
      clinicId: ctx.clinicId,
      clinicName: clinic?.name ?? "",
      clinicPhone: clinic?.phone ?? null,
      timezone: clinic?.timezone ?? "America/Mexico_City",
      patient,
      patientId: patient?.id ?? null,
      now,
      canSeeBilling,
    });

    const templates = parseWaTemplates(clinic?.waTemplates ?? null);
    const options: InboxTemplateOption[] = [];
    for (const kind of kindsFor(canSeeBilling)) {
      const built = buildOne(kind, facts, templates);
      if (built) options.push(built.option);
    }

    return NextResponse.json({
      windowOpen,
      waConnected,
      billingOk,
      patientName: displayName(patient),
      options,
      unavailableReason: describeNoTemplatesAvailable({ options, waConnected, billingOk }),
      manageHref: MANAGE_HREF,
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
    if (!(kindsFor(canSeeBilling) as readonly string[]).includes(kind)) {
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
    if (!clinic?.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
      return NextResponse.json(
        { error: "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp." },
        { status: 409 },
      );
    }

    const now = new Date();
    const patient = await resolveThreadPatient(thread, viewer);
    const facts = await loadTemplateFacts({
      clinicId: ctx.clinicId,
      clinicName: clinic.name ?? "",
      clinicPhone: clinic.phone ?? null,
      timezone: clinic.timezone ?? "America/Mexico_City",
      patient,
      patientId: patient?.id ?? null,
      now,
      canSeeBilling,
    });

    // Los params se RECALCULAN aquí, nunca llegan del body: son el texto que
    // Meta le entrega al paciente firmado por la clínica.
    const built = buildOne(kind, facts, parseWaTemplates(clinic.waTemplates ?? null));
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
