// "Qué plantillas aprobadas se le pueden mandar HOY a este paciente" — y con
// qué valores exactos se rellenan.
//
// POR QUÉ EXISTE ESTE MÓDULO: esta lógica nació DENTRO de
// src/app/api/inbox/threads/[id]/templates/route.ts, atada a un hilo que ya
// existía. Pero el caso que faltaba —INICIAR una conversación con un paciente
// que nunca ha escrito— no tiene hilo del que partir, y aun así necesita
// exactamente lo mismo: las plantillas aprobadas de la clínica, rellenadas con
// los datos reales del paciente, y el motivo en español de las que no.
//
// Copiar el archivo habría dejado dos fuentes que se separan en el primer
// cambio de redacción: lo que el composer previsualiza y lo que el servidor
// envía dejarían de ser lo mismo. Así que la lógica vive AQUÍ y las dos rutas
// —la del hilo y la de "iniciar conversación"— la consumen.
//
// El punto de partida es un PACIENTE, no un hilo: es el denominador común de
// los dos casos (el hilo resuelve su paciente antes de llamar).
//
// NO es puro: consulta citas y saldo. Lo puro —cómo se pinta cada opción y qué
// decir cuando ninguna sirve— sigue en lib/inbox/composer-templates.

import { prisma } from "@/lib/prisma";
import {
  INBOX_COMPOSER_KINDS,
  buildInboxTemplateOption,
  type InboxTemplateOption,
} from "@/lib/inbox/composer-templates";
import { catalogEntryFor } from "@/lib/whatsapp/templates-catalog";
import { parseWaTemplates, type WaTemplateMap } from "@/lib/whatsapp/template-config";
import { WA_ERROR_CODE } from "@/lib/whatsapp/errors";
import type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";

/** Dónde se dan de alta las plantillas (lo abre el enlace del composer). */
export const TEMPLATES_MANAGE_HREF = "/dashboard/whatsapp/plantillas";

/**
 * Columnas de Clinic que hacen falta para ofrecer y enviar una plantilla.
 *
 * Es un `select` explícito y no la fila entera A PROPÓSITO: `Clinic` lleva
 * secretos (tokens de Meta, llaves de Facturapi) y de estas rutas sale JSON al
 * navegador. `waAccessToken` se carga para PODER enviar, nunca para responderlo.
 */
export const TEMPLATE_CLINIC_SELECT = {
  id: true,
  name: true,
  phone: true,
  timezone: true,
  waConnected: true,
  waPhoneNumberId: true,
  waAccessToken: true,
  waTemplates: true,
  waBillingOk: true,
} as const;

/** La clínica tal como la necesitan estas funciones (lo que trae el select). */
export interface TemplateClinic {
  id: string;
  name: string | null;
  phone: string | null;
  timezone: string | null;
  waConnected: boolean | null;
  waPhoneNumberId: string | null;
  waAccessToken: string | null;
  waTemplates: unknown;
  waBillingOk: boolean | null;
}

/** Paciente mínimo con el que se rellenan las plantillas. */
export interface TemplatePatient {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
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
 * Es la MISMA función para previsualizar y para enviar a propósito: lo que se
 * ve y lo que sale no pueden divergir.
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
export interface TemplateOffer {
  option: InboxTemplateOption;
  /** Valores de {{1}}…{{n}} listos para `sendWhatsAppLogged`, o null. */
  params: string[] | null;
}

function buildOne(
  kind: WhatsAppSendKind,
  facts: TemplateFacts,
  templates: WaTemplateMap,
): TemplateOffer | null {
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
export function kindsForSession(canSeeBilling: boolean): readonly WhatsAppSendKind[] {
  if (canSeeBilling) return INBOX_COMPOSER_KINDS;
  return INBOX_COMPOSER_KINDS.filter((k) => k !== "payment_notice");
}

/** Todas las plantillas ofrecibles a un paciente, con sus params ya calculados. */
export interface TemplateOffering {
  /** En el orden del catálogo: es el orden en que se pintan los chips. */
  options: InboxTemplateOption[];
  /** La misma información indexada por tipo, para el envío. */
  byKind: Map<WhatsAppSendKind, TemplateOffer>;
}

/**
 * Arma la oferta completa para un paciente (o para un hilo sin paciente, con
 * `patient: null`).
 *
 * Los params se calculan SIEMPRE en el servidor y nunca se aceptan del body:
 * son el texto que Meta le entrega al paciente firmado por la clínica.
 */
export async function buildTemplateOffering(args: {
  clinicId: string;
  clinic: Pick<TemplateClinic, "name" | "phone" | "timezone" | "waTemplates">;
  patient: TemplatePatient | null;
  canSeeBilling: boolean;
  now: Date;
}): Promise<TemplateOffering> {
  const facts = await loadTemplateFacts({
    clinicId: args.clinicId,
    clinicName: args.clinic.name ?? "",
    clinicPhone: args.clinic.phone ?? null,
    timezone: args.clinic.timezone ?? "America/Mexico_City",
    patient: args.patient,
    patientId: args.patient?.id ?? null,
    now: args.now,
    canSeeBilling: args.canSeeBilling,
  });

  const templates = parseWaTemplates(args.clinic.waTemplates ?? null);
  const options: InboxTemplateOption[] = [];
  const byKind = new Map<WhatsAppSendKind, TemplateOffer>();
  for (const kind of kindsForSession(args.canSeeBilling)) {
    const built = buildOne(kind, facts, templates);
    if (!built) continue;
    options.push(built.option);
    byKind.set(kind, built);
  }
  return { options, byKind };
}

/** Nombre completo para el encabezado del composer ("Se enviará a …"). */
export function templateDisplayName(
  p: { firstName: string; lastName: string } | null,
): string | null {
  if (!p) return null;
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return name || null;
}

/**
 * Error de Meta → español, POR CÓDIGO. El texto de Meta cambia de redacción y
 * viene en inglés; el número es el único dato estable. Nunca se le enseña el
 * error crudo a la clínica.
 */
export function describeMetaError(code: number | null): string {
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

/**
 * Motivo por el que la clínica no puede enviar NINGUNA plantilla por razones de
 * conexión, o null si por ahí no hay problema. Se comprueba antes de llamar a
 * Meta: sin esto el envío iría con credenciales vacías y volvería un error
 * opaco en vez de decir qué hay que conectar.
 */
export function describeWhatsAppNotReady(clinic: {
  waConnected: boolean | null;
  waPhoneNumberId: string | null;
  waAccessToken: string | null;
}): string | null {
  if (!clinic.waConnected || !clinic.waPhoneNumberId || !clinic.waAccessToken) {
    return "WhatsApp no está conectado en esta clínica. Conéctalo en Configuración → WhatsApp.";
  }
  return null;
}
