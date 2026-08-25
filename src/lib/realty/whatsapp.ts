import "server-only";
// ═══════════════════════════════════════════════════════════════════════
// DaleControl INMUEBLES — WhatsApp del vertical (capa de servidor).
//
// 🔴 ESTE ARCHIVO ES EL ÚNICO QUE MANDA WHATSAPP EN EL VERTICAL.
// Nada de aquí toca al dental ni a barber. Del núcleo compartido
// (src/lib/whatsapp.ts) solo se IMPORTAN funciones — ese archivo NO se
// modificó ni un carácter, igual que hizo barber, porque sus 7 exports
// reciben credenciales sueltas y no saben nada de Clinic.
//
// El enganche al webhook compartido está en
// src/app/api/whatsapp/webhook/route.ts y son dos bloques ADITIVOS dentro
// del `if (!clinic)` que ya existía: el camino dental se resuelve ARRIBA y
// no cambia. Los dos puntos de entrada que llama son:
//     ingestRealtyInbound(value, msg)          → mensajes que entran
//     applyRealtyDeliveryStatuses(id, statuses) → palomitas de Meta
// Los dos devuelven boolean: false = "este número no es de inmuebles",
// que es la señal para que el webhook siga buscando o registre el aviso.
//
// GATE DEL PLAN: WhatsApp vive SOLO en ASESOR ($349) e INMOBILIARIA ($649).
// El plan PROPIETARIO ($199) no lo tiene. Se comprueba por la FEATURE
// `whatsapp` del plan resuelto, NUNCA por el id del plan: los planes se
// editan en realty_plan_configs sin redeploy y un `plan === "ASESOR"`
// escrito a mano se quedaría viejo el día que alguien mueva la escalera.
// ═══════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { decryptField, encryptField } from "@/lib/crypto/envelope";
import {
  getWhatsAppMediaMeta,
  markWhatsAppMessageRead,
  normalizeMxWhatsAppPhone,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
} from "@/lib/whatsapp";
import {
  WA_ERROR_CODE,
  WhatsAppApiError,
  formatWaErrorMessage,
  parseWaError,
  waErrorCode,
} from "@/lib/whatsapp/errors";
import { getRealtyPlan } from "@/lib/realty/plans";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { REALTY_PUBLIC_BASE } from "@/lib/realty/types";
import {
  REALTY_MATCH_DAILY_CAP,
  REALTY_MATCH_PER_CONTACT_DAILY_CAP,
  REALTY_MAX_SEND_ATTEMPTS,
  REALTY_WA_PENDING_MARK,
  REALTY_WA_TEMPLATES,
  buildRealtyClaimKey,
  buildRealtyWaQuota,
  claimSuffix,
  claimedExternalId,
  classifyRealtyReply,
  encodeRealtyWaMedia,
  formatRealtyWaDate,
  formatRealtyWaLongDate,
  formatRealtyWaTime,
  formatRealtyWaPrice,
  isRealtyWaSendErr,
  isRealtyWaSendOk,
  nextRealtyWaStatus,
  parseRealtyWaMedia,
  realtyMatchClaimKey,
  realtyVisitClaimKey,
  realtyWaFits,
  realtyWaTemplate,
  realtyWaWindowOpen,
  startOfDayInTz,
  renderRealtyWaTemplate,
  sentExternalId,
  wamidFromExternalId,
  type RealtyWaConnectionDTO,
  type RealtyWaKind,
  type RealtyWaMedia,
  type RealtyWaQuotaDTO,
  type RealtyWaSendResult,
  type RealtyWaThreadRowDTO,
} from "@/lib/realty/whatsapp-core";
import type { RealtyMessageDTO } from "@/lib/realty/types";
import type {
  RealtyLeadWhatsappResult,
  RealtyLeadWhatsappTrigger,
} from "@/lib/realty/inbound-mail";

const GRAPH = "https://graph.facebook.com/v19.0";

/** Periodo del cupo: 30 días rodantes, igual que barber. */
const QUOTA_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** Ventana en la que el cron manda el recordatorio de visita. */
const VISIT_MIN_LEAD_MS = 45 * 60 * 1000;
const VISIT_MAX_LEAD_MS = 24 * 60 * 60 * 1000;

// ── Credenciales ────────────────────────────────────────────────────────

export interface RealtyWaCredentials {
  accountId: string;
  phoneNumberId: string;
  accessToken: string;
  wabaId: string | null;
  accountName: string;
  timezone: string;
  locale: string;
  slug: string;
}

/** Columnas de la cuenta que necesita TODO lo de WhatsApp. */
const ACCOUNT_WA_SELECT = {
  id: true,
  name: true,
  slug: true,
  phone: true,
  plan: true,
  timezone: true,
  locale: true,
  isActive: true,
  whatsappSenderMode: true,
  wabaId: true,
  phoneNumberId: true,
  whatsappToken: true,
  whatsappVerifiedAt: true,
  messageQuota: true,
  messagesUsedPeriod: true,
  messagesPeriodStart: true,
} as const;

type AccountWaRow = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  plan: string;
  timezone: string;
  locale: string;
  isActive: boolean;
  whatsappSenderMode: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  whatsappToken: string | null;
  whatsappVerifiedAt: Date | null;
  messageQuota: number | null;
  messagesUsedPeriod: number;
  messagesPeriodStart: Date | null;
};

/**
 * ¿Está encendido el número de la PLATAFORMA? Cuando una cuenta elige
 * PLATFORM manda desde el número de DaleControl y el cupo del plan es el
 * freno. Apagado por defecto: sin las tres variables NADIE manda por ahí.
 */
export function platformSenderEnabled(): boolean {
  return (
    process.env.REALTY_WA_PLATFORM_SENDER === "1" &&
    !!process.env.REALTY_WA_PLATFORM_PHONE_NUMBER_ID &&
    !!process.env.REALTY_WA_PLATFORM_TOKEN
  );
}

/**
 * Credenciales con las que sale un mensaje de esta cuenta, o null si no hay.
 * PUNTO ÚNICO: ninguna pantalla ni ruta arma esto por su cuenta.
 */
export function resolveRealtyCredentials(account: AccountWaRow): RealtyWaCredentials | null {
  const base = {
    accountId: account.id,
    accountName: account.name,
    timezone: account.timezone,
    locale: account.locale,
    slug: account.slug,
  };

  if (account.whatsappSenderMode === "OWN_WABA") {
    if (!account.phoneNumberId || !account.whatsappToken) return null;
    const token = decryptField(account.whatsappToken) ?? account.whatsappToken;
    if (!token) return null;
    return { ...base, phoneNumberId: account.phoneNumberId, accessToken: token, wabaId: account.wabaId };
  }

  if (!platformSenderEnabled()) return null;
  return {
    ...base,
    phoneNumberId: String(process.env.REALTY_WA_PLATFORM_PHONE_NUMBER_ID),
    accessToken: String(process.env.REALTY_WA_PLATFORM_TOKEN),
    wabaId: process.env.REALTY_WA_PLATFORM_WABA_ID ?? null,
  };
}

/**
 * Resuelve la cuenta por el phone_number_id de Meta. El tenant NUNCA sale
 * del cuerpo del webhook: solo de esta columna.
 *
 * En modo PLATFORM todas las cuentas comparten el número de DaleControl, así
 * que ese id NO identifica a nadie: por eso solo se busca entre las que
 * conectaron su propia WABA. Un mensaje al número de la plataforma se
 * atiende por el hilo, no por el número.
 *
 * ⚠️ INVARIANTE PRESTADA — lo que impide que un número de BARBERÍA acabe en
 * un hilo de inmuebles.
 *
 * NO hay constraint entre tablas: `Barbershop.phoneNumberId` y
 * `RealtyAccount.phoneNumberId` son dos columnas sueltas y nada impide que
 * alguien registre el mismo id en las dos. Lo que hoy lo hace imposible es el
 * ORDEN del webhook más un detalle que vive en OTRO vertical:
 * `shopByPhoneNumberId` (src/lib/barber/whatsapp.ts) busca la barbería SIN
 * filtros — ni `isActive`, ni verificado, ni modo de envío — así que barber
 * reclama CUALQUIER número suyo y el webhook nunca se lo ofrece a inmuebles.
 *
 * 🔴 Si algún día alguien estrecha esa consulta de barber (poner
 * `isActive: true` es lo más natural del mundo), el número de una barbería
 * desactivada empezaría a caer aquí EN SILENCIO. El día que eso pase, la
 * defensa de verdad es un único parcial en la base o una comprobación
 * explícita en este archivo — no la suerte.
 */
async function accountByPhoneNumberId(phoneNumberId: unknown): Promise<AccountWaRow | null> {
  if (typeof phoneNumberId !== "string" || !phoneNumberId) return null;
  return (await prisma.realtyAccount.findFirst({
    where: { phoneNumberId, whatsappSenderMode: "OWN_WABA" },
    select: ACCOUNT_WA_SELECT,
  })) as AccountWaRow | null;
}

async function accountById(accountId: string): Promise<AccountWaRow | null> {
  return (await prisma.realtyAccount.findUnique({
    where: { id: accountId },
    select: ACCOUNT_WA_SELECT,
  })) as AccountWaRow | null;
}

/** ¿El plan de esta cuenta incluye WhatsApp? Por FEATURE, nunca por id. */
async function accountHasWhatsApp(account: AccountWaRow): Promise<boolean> {
  const plan = await getRealtyPlan(account.plan);
  return realtyPlanHasFeature(plan, "whatsapp");
}

// ── Cupo ────────────────────────────────────────────────────────────────

/**
 * Cupo del periodo. El límite sale del plan salvo que la cuenta tenga uno
 * PROPIO (messageQuota != null lo PISA — así soporte puede regalar mensajes
 * sin tocar la tabla de planes).
 *
 * El corte de periodo se hace con updateMany acotado al periodStart VIEJO:
 * si dos peticiones entran a la vez, solo una escribe y la otra ve count 0
 * y respeta lo que quedó. Un `update` a secas las dejaría a las dos en cero.
 */
export async function getRealtyWaQuota(accountId: string): Promise<RealtyWaQuotaDTO> {
  const account = await accountById(accountId);
  if (!account) return buildRealtyWaQuota({ limit: 0, used: 0, periodStart: null });

  const plan = await getRealtyPlan(account.plan);
  const limit = account.messageQuota ?? plan.messageQuota;

  const now = new Date();
  let used = account.messagesUsedPeriod;
  let periodStart = account.messagesPeriodStart;

  if (!periodStart || now.getTime() - periodStart.getTime() >= QUOTA_PERIOD_MS) {
    const previous = periodStart;
    const written = await prisma.realtyAccount.updateMany({
      where: { id: account.id, messagesPeriodStart: previous },
      data: { messagesPeriodStart: now, messagesUsedPeriod: 0 },
    });
    if (written.count > 0) {
      used = 0;
      periodStart = now;
    }
  }

  return buildRealtyWaQuota({ limit, used, periodStart });
}

/**
 * Suma uno al cupo. Se llama SOLO cuando Meta ya aceptó el mensaje: el cupo
 * cuenta lo que se mandó, no lo que se intentó. Falla en silencio a
 * propósito — perder la cuenta de un mensaje no puede tumbar el envío.
 */
async function consumeRealtyQuota(accountId: string): Promise<void> {
  try {
    await prisma.realtyAccount.update({
      where: { id: accountId },
      data: { messagesUsedPeriod: { increment: 1 } },
    });
  } catch (e) {
    console.error(`[realty/wa] no se pudo sumar al cupo (${accountId}):`, e);
  }
}

// ── Conexión ────────────────────────────────────────────────────────────

export async function getRealtyWaConnection(accountId: string): Promise<RealtyWaConnectionDTO> {
  const account = await accountById(accountId);
  const empty: RealtyWaConnectionDTO = {
    state: "DISCONNECTED",
    senderMode: "PLATFORM",
    displayPhone: null,
    wabaId: null,
    phoneNumberId: null,
    verifiedAt: null,
    problem: null,
    canConnect: false,
  };
  if (!account) return empty;

  const senderMode = account.whatsappSenderMode === "OWN_WABA" ? "OWN_WABA" : "PLATFORM";
  const hasFeature = await accountHasWhatsApp(account);

  if (!hasFeature) {
    return {
      ...empty,
      senderMode,
      state: "PLAN_LOCKED",
      problem: "Tu plan no incluye WhatsApp.",
      canConnect: false,
    };
  }

  if (senderMode === "PLATFORM") {
    const on = platformSenderEnabled();
    return {
      ...empty,
      senderMode,
      // 🔴 "UNVERIFIED" y NO "CONNECTED", aunque los envíos salgan.
      //
      // En modo PLATFORM todas las cuentas comparten el número de
      // DaleControl, así que el phone_number_id que trae el webhook NO
      // identifica a nadie: ni los mensajes que ENTRAN ni las palomitas de
      // Meta se pueden asignar a una cuenta. Es decir, es un canal de IDA.
      //
      // Se podría adivinar por el teléfono de quien escribe, pero si dos
      // inmobiliarias tienen al mismo prospecto en su cartera, ese mensaje
      // acabaría en el Inbox equivocado. Preferimos decir la verdad antes
      // que arriesgar una fuga entre cuentas.
      //
      // Decirle "conectado" sería el fallo mudo de siempre: un mensaje que
      // Meta RECHAZÓ se quedaría en "enviado" para siempre, porque el estado
      // de entrega nunca llegaría. Mientras esto siga así, el camino bueno
      // es que la cuenta conecte su propia WABA.
      state: on ? "UNVERIFIED" : "DISCONNECTED",
      displayPhone: on ? "Número de DaleControl" : null,
      problem: on
        ? "Los mensajes salen, pero las respuestas y los acuses de entrega no se pueden asignar a tu cuenta: el número es compartido. Conecta tu propio número de WhatsApp para tener el Inbox completo."
        : "El número de la plataforma todavía no está disponible.",
      canConnect: true,
    };
  }

  if (!account.phoneNumberId || !account.whatsappToken) {
    return {
      ...empty,
      senderMode,
      state: "DISCONNECTED",
      wabaId: account.wabaId,
      phoneNumberId: account.phoneNumberId,
      problem: "Falta conectar tu número de WhatsApp.",
      canConnect: true,
    };
  }

  return {
    state: account.whatsappVerifiedAt ? "CONNECTED" : "UNVERIFIED",
    senderMode,
    displayPhone: account.phoneNumberId,
    wabaId: account.wabaId,
    phoneNumberId: account.phoneNumberId,
    verifiedAt: account.whatsappVerifiedAt ? account.whatsappVerifiedAt.toISOString() : null,
    problem: account.whatsappVerifiedAt
      ? null
      : "El número está guardado pero Meta todavía no lo confirma.",
    canConnect: true,
  };
}

export async function saveRealtyWaConnection(args: {
  accountId: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  verified: boolean;
}): Promise<void> {
  await prisma.realtyAccount.update({
    where: { id: args.accountId },
    data: {
      whatsappSenderMode: "OWN_WABA",
      wabaId: args.wabaId || null,
      phoneNumberId: args.phoneNumberId,
      // 🔴 CIFRADO en reposo. El schema de la Ola 0 lo pedía por escrito:
      // un token de WhatsApp en claro es la cuenta entera de Meta.
      whatsappToken: encryptField(args.token),
      whatsappVerifiedAt: args.verified ? new Date() : null,
    },
  });
}

export async function disconnectRealtyWa(accountId: string): Promise<void> {
  await prisma.realtyAccount.update({
    where: { id: accountId },
    data: {
      whatsappSenderMode: "PLATFORM",
      wabaId: null,
      phoneNumberId: null,
      whatsappToken: null,
      whatsappVerifiedAt: null,
    },
  });
}

// ── Plantillas en Meta ──────────────────────────────────────────────────

export interface RealtyTemplateStatus {
  kind: RealtyWaKind;
  name: string;
  category: string;
  /** APPROVED | PENDING | REJECTED | MISSING */
  status: string;
  reason: string | null;
  optional: boolean;
}

/**
 * Estado REAL de las plantillas, preguntándoselo a Meta. No se guarda en la
 * base a propósito: el estado lo cambia Meta cuando quiere y una copia
 * nuestra envejece sin avisar (mismo criterio que barber).
 */
export async function listRealtyTemplates(
  accountId: string,
): Promise<{ ok: boolean; reason?: string; templates: RealtyTemplateStatus[] }> {
  const account = await accountById(accountId);
  if (!account) return { ok: false, reason: "Cuenta no encontrada.", templates: [] };

  const base: RealtyTemplateStatus[] = REALTY_WA_TEMPLATES.map((t) => ({
    kind: t.kind,
    name: t.name,
    category: t.category,
    status: "MISSING",
    reason: null,
    optional: t.optional,
  }));

  const creds = resolveRealtyCredentials(account);
  if (!creds || !creds.wabaId) {
    return {
      ok: false,
      reason: "Conecta tu WhatsApp para ver el estado de las plantillas.",
      templates: base,
    };
  }

  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(creds.wabaId)}/message_templates?limit=100`,
      {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw parseWaError(json, res.status);

    const live = Array.isArray(json?.data) ? json.data : [];
    for (const row of base) {
      const hit = live.find((t: any) => t?.name === row.name);
      if (!hit) continue;
      row.status = String(hit.status ?? "PENDING").toUpperCase();
      row.reason = typeof hit.rejected_reason === "string" ? hit.rejected_reason : null;
    }
    return { ok: true, templates: base };
  } catch (e) {
    console.error(`[realty/wa] no se pudieron leer las plantillas (${accountId}):`, e);
    return {
      ok: false,
      reason: e instanceof WhatsAppApiError ? e.message : "Meta no contestó.",
      templates: base,
    };
  }
}

/**
 * El cuerpo con el que se DA DE ALTA una plantilla en Meta.
 *
 * 🔴 AUTHENTICATION no se crea como las demás, y darse cuenta tarde cuesta
 * caro: mandarle a Meta un `BODY` con `text: ""` lo rechaza, la plantilla
 * nunca aterriza en la WABA y el código del portal del cliente falla PARA
 * SIEMPRE con un 132001 que nadie ve, porque deliverPortalCode se lo traga a
 * propósito. Meta las quiere con tres componentes y el texto lo pone él:
 *   BODY con add_security_recommendation, FOOTER con la caducidad, y
 *   BUTTONS con un OTP de tipo COPY_CODE.
 * Mismo payload que usa barber para su código de acceso.
 */
function templateCreatePayload(tpl: {
  name: string;
  lang: string;
  category: string;
  body: string;
  variables: string[];
  sample: string[];
}): Record<string, unknown> {
  if (tpl.category === "AUTHENTICATION") {
    return {
      name: tpl.name,
      language: tpl.lang,
      category: "AUTHENTICATION",
      components: [
        { type: "BODY", add_security_recommendation: true },
        { type: "FOOTER", code_expiration_minutes: 10 },
        { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" }] },
      ],
    };
  }
  return {
    name: tpl.name,
    language: tpl.lang,
    category: tpl.category,
    components: [
      {
        type: "BODY",
        text: tpl.body,
        ...(tpl.variables.length > 0
          ? { example: { body_text: [tpl.sample.slice(0, tpl.variables.length)] } }
          : {}),
      },
    ],
  };
}

/** Da de alta en la WABA de la cuenta las plantillas que falten. */
export async function provisionRealtyTemplates(
  accountId: string,
  opts: { includeMarketing?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; created: string[]; failed: { name: string; error: string }[] }> {
  const account = await accountById(accountId);
  if (!account) return { ok: false, reason: "Cuenta no encontrada.", created: [], failed: [] };

  const creds = resolveRealtyCredentials(account);
  if (!creds || !creds.wabaId) {
    return { ok: false, reason: "Conecta tu WhatsApp primero.", created: [], failed: [] };
  }

  const current = await listRealtyTemplates(accountId);
  const created: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const tpl of REALTY_WA_TEMPLATES) {
    if (tpl.optional && !opts.includeMarketing) continue;
    const state = current.templates.find((t) => t.name === tpl.name);
    // Lo que ya existe y no está rechazado se deja en paz: crear otra vez
    // devuelve error y no arregla nada.
    if (state && state.status !== "MISSING" && state.status !== "REJECTED") continue;

    try {
      const res = await fetch(`${GRAPH}/${encodeURIComponent(creds.wabaId)}/message_templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.accessToken}`,
        },
        body: JSON.stringify(templateCreatePayload(tpl)),
        signal: AbortSignal.timeout(20000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = parseWaError(json, res.status);
        // 2388023 = "ya existe": para nosotros es éxito, no error.
        if (err.code === 2388023) continue;
        throw err;
      }
      created.push(tpl.name);
    } catch (e) {
      failed.push({ name: tpl.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { ok: failed.length === 0, created, failed };
}

// ── Hilos y registro ────────────────────────────────────────────────────

/**
 * Hilo de un teléfono, creándolo si hace falta. El teléfono SIEMPRE se
 * normaliza a 10 dígitos: si se guarda como lo escribió la persona, el
 * webhook no logra ligar la conversación con su contacto y el inbox se
 * llena de hilos sin nombre (lo dice el propio schema de la Ola 0).
 */
async function upsertRealtyThread(args: {
  accountId: string;
  phone: string;
  contactId?: string | null;
  markUnread?: boolean;
}): Promise<{ id: string; contactId: string | null } | null> {
  const phone = mxTenDigits(args.phone);
  if (!phone) return null;

  // Se LIGA a un contacto que ya exista; jamás se crea uno desde aquí. Un
  // número equivocado no puede dar de alta prospectos fantasma.
  //
  // 🔴 EL contactId QUE LLEGA SE VUELVE A COMPROBAR CONTRA LA CUENTA, SIEMPRE.
  // Algunas rutas lo reciben en el cuerpo de la petición, y validarlo solo
  // para LEER el nombre (y luego escribir el id crudo) es exactamente cómo se
  // cuela una escritura entre inquilinos: el hilo de la cuenta A acababa
  // apuntando al contacto de la cuenta B, y la lista de conversaciones pintaba
  // el NOMBRE de esa persona. La FK no lo impide — referencia `id` a secas, sin
  // accountId. Este findFirst acotado es el que lo impide.
  let contactId: string | null = null;
  if (args.contactId) {
    const owned = await prisma.realtyContact.findFirst({
      where: { id: args.contactId, accountId: args.accountId },
      select: { id: true },
    });
    contactId = owned?.id ?? null;
  }
  if (!contactId) {
    const contact = await prisma.realtyContact.findFirst({
      where: { accountId: args.accountId, phone },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    contactId = contact?.id ?? null;
  }

  const now = new Date();
  const thread = await prisma.realtyThread.upsert({
    where: { accountId_phone: { accountId: args.accountId, phone } },
    create: {
      accountId: args.accountId,
      phone,
      contactId,
      lastMessageAt: now,
      unread: args.markUnread ? 1 : 0,
    },
    update: {
      lastMessageAt: now,
      ...(args.markUnread ? { unread: { increment: 1 }, archived: false } : {}),
      // Si el contacto se dio de alta DESPUÉS del primer mensaje, el hilo se
      // adopta ahora. Nunca se desliga uno ya puesto.
      ...(contactId ? { contactId } : {}),
    },
    select: { id: true, contactId: true },
  });
  return thread;
}

/** Último mensaje ENTRANTE del hilo — la ventana de 24 h se mide con esto. */
async function lastInboundAt(threadId: string): Promise<Date | null> {
  const row = await prisma.realtyMessage.findFirst({
    where: { threadId, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

// ── EL punto único de envío ─────────────────────────────────────────────

export interface SendRealtyArgs {
  accountId: string;
  /** Teléfono destino (se normaliza). */
  phone: string;
  /** Texto libre — se manda tal cual si la ventana de 24 h está abierta. */
  body: string;
  /** Qué plantilla usar si la ventana está cerrada. null = solo texto. */
  kind?: RealtyWaKind | null;
  /** Parámetros {{1}}…{{n}} de la plantilla, EN ORDEN. */
  params?: string[] | null;
  contactId?: string | null;
  /** Llave de idempotencia de un envío automático. */
  claimKey?: string | null;
  /** Foto que acompaña al mensaje (solo dentro de la ventana). */
  imageUrl?: string | null;
  /** true = no descuenta ni comprueba el cupo (nada lo usa hoy). */
  skipQuota?: boolean;
}

/**
 * MANDA Y REGISTRA. Es el único camino: ninguna pantalla llama a Meta por su
 * cuenta, y por eso el cupo, la ventana de 24 h y el registro en el hilo no
 * se pueden saltar.
 *
 * El orden de las comprobaciones importa y cada una tiene su porqué:
 *   1. cuenta activa y plan CON la feature — la pantalla puede mentir, esto no;
 *   2. credenciales — sin número conectado no hay nada que intentar;
 *   3. cupo — antes de gastar el intento;
 *   4. idempotencia (si hay llave) — para que el cron no mande dos veces;
 *   5. ventana de 24 h — decide texto libre o plantilla;
 *   6. se RECLAMA la fila, luego se manda, y solo si Meta acepta se suma al
 *      cupo y se sella el wamid.
 *
 * Nunca lanza: devuelve un resultado con el motivo en español, listo para
 * pintarse. Un fallo de WhatsApp no puede tumbar la pantalla que lo llamó.
 */
export async function sendRealtyWhatsApp(args: SendRealtyArgs): Promise<RealtyWaSendResult> {
  try {
    const account = await accountById(args.accountId);
    if (!account) return { ok: false, error: "Cuenta no encontrada.", reason: "not_found" };
    if (!account.isActive) return { ok: false, error: "La cuenta está desactivada.", reason: "plan" };

    if (!(await accountHasWhatsApp(account))) {
      return {
        ok: false,
        error: "Tu plan no incluye WhatsApp. Está en los planes Asesor e Inmobiliaria.",
        reason: "plan",
      };
    }

    const creds = resolveRealtyCredentials(account);
    if (!creds) {
      return { ok: false, error: "Todavía no has conectado un número de WhatsApp.", reason: "not_connected" };
    }

    const phone = mxTenDigits(args.phone);
    if (!phone) return { ok: false, error: "El teléfono no tiene 10 dígitos.", reason: "phone" };

    if (!args.skipQuota) {
      const quota = await getRealtyWaQuota(args.accountId);
      if (!realtyWaFits(quota.limit, quota.used)) {
        return { ok: false, error: "Se acabaron los mensajes incluidos de este periodo.", reason: "quota" };
      }
    }

    const thread = await upsertRealtyThread({
      accountId: args.accountId,
      phone,
      contactId: args.contactId ?? null,
    });
    if (!thread) return { ok: false, error: "El teléfono no tiene 10 dígitos.", reason: "phone" };

    // 4. Idempotencia CON reintento acotado. La búsqueda va acotada al HILO,
    //    así que recorre los pocos mensajes de esa conversación y no la tabla.
    //
    //    Un intento VIVO (reclamado o ya mandado) tiene un externalId que
    //    TERMINA en la llave → ese aviso no se vuelve a mandar, nunca.
    //    Un intento FALLIDO lleva "#<id>" pegado al final (ver el catch de
    //    abajo), así que YA NO termina en la llave y deja pasar el siguiente.
    //
    //    🔴 Por qué el reintento: un 500 pasajero de Meta dejaba el aviso de
    //    cobro muerto PARA SIEMPRE, y encima contado como "saltado" en vez de
    //    "fallido", o sea en silencio. Y por qué ACOTADO: con una plantilla
    //    rechazada, reintentar cada 15 minutos es pegarle a Meta toda la vida.
    let attempts = 0;
    if (args.claimKey) {
      const suffix = claimSuffix(args.claimKey);
      const prior = await prisma.realtyMessage.findMany({
        where: { threadId: thread.id, externalId: { contains: suffix } },
        select: { externalId: true },
        take: REALTY_MAX_SEND_ATTEMPTS + 1,
      });
      if (prior.some((r) => r.externalId?.endsWith(suffix))) {
        return { ok: false, error: "Ese aviso ya se había mandado.", reason: "duplicate" };
      }
      attempts = prior.length;
      if (attempts >= REALTY_MAX_SEND_ATTEMPTS) {
        return {
          ok: false,
          error: `Se intentó ${attempts} veces y WhatsApp no lo aceptó. Revísalo a mano.`,
          reason: "retries",
        };
      }
    }

    // 5. Ventana de 24 h. Fuera de ella Meta responde 131047 y el mensaje NO
    //    llega — pero el panel lo pintaría como enviado si no se decidiera
    //    aquí. Ese es exactamente el fallo mudo que no se repite.
    const windowOpen = realtyWaWindowOpen(await lastInboundAt(thread.id));
    const tpl = args.kind ? realtyWaTemplate(args.kind) : null;
    const params = (args.params ?? []).map((p) => String(p ?? "").trim());

    if (!windowOpen) {
      if (!tpl) {
        return {
          ok: false,
          error:
            "Fuera de la ventana de 24 h: para escribirle primero hace falta una plantilla aprobada.",
          reason: "window",
        };
      }
      if (params.length !== tpl.variables.length) {
        return {
          ok: false,
          error:
            `La plantilla espera ${tpl.variables.length} datos y se prepararon ${params.length}. ` +
            "No se envió para no gastar un intento rechazado.",
          reason: "params",
        };
      }
      const blank = params.findIndex((p) => !p);
      if (blank >= 0) {
        return {
          ok: false,
          error: `Falta el dato {{${blank + 1}}} de la plantilla (WhatsApp rechaza las variables vacías).`,
          reason: "params",
        };
      }
    }

    // Lo que se GUARDA es lo que la persona va a leer: si sale plantilla, se
    // registra la plantilla ya pintada y no el texto libre que no se mandó.
    const storedBody = windowOpen ? args.body : renderRealtyWaTemplate(tpl!, params);
    const templateName = windowOpen ? null : tpl!.name;

    // 6. Se reclama la fila ANTES de mandar. El @@unique([threadId,
    //    externalId]) es el seguro contra dos crones simultáneos: el segundo
    //    choca con P2002 y se va sin mandar nada.
    let row: { id: string };
    try {
      row = await prisma.realtyMessage.create({
        data: {
          accountId: args.accountId,
          threadId: thread.id,
          direction: "OUTBOUND",
          body: storedBody,
          mediaUrl: windowOpen ? args.imageUrl ?? null : null,
          templateName,
          externalId: args.claimKey ? claimedExternalId(args.claimKey) : null,
          status: "PENDING",
        },
        select: { id: true },
      });
    } catch (e: any) {
      if (e?.code === "P2002") return { ok: false, error: "Ese aviso ya se había mandado.", reason: "duplicate" };
      throw e;
    }

    try {
      let wamid: string | null = null;

      if (windowOpen && args.imageUrl) {
        // La foto va como mensaje de imagen CON pie: es lo que el asesor
        // manda 20 veces al día y una liga suelta no lo sustituye.
        const res = await postRealtyGraph(creds, {
          messaging_product: "whatsapp",
          to: normalizeMxWhatsAppPhone(phone),
          type: "image",
          image: { link: args.imageUrl, caption: args.body.slice(0, 1024) },
        });
        wamid = res.wamid;
      } else if (windowOpen) {
        const res = await sendWhatsAppMessage(
          creds.phoneNumberId,
          creds.accessToken,
          phone,
          args.body,
        );
        wamid = res?.messages?.[0]?.id ?? null;
      } else {
        const res = await sendWhatsAppTemplate(
          creds.phoneNumberId,
          creds.accessToken,
          phone,
          { name: tpl!.name, lang: tpl!.lang },
          params,
        );
        wamid = res?.messages?.[0]?.id ?? null;
      }

      await prisma.realtyMessage.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          externalId: args.claimKey
            ? sentExternalId(wamid ?? "sin-wamid", args.claimKey)
            : wamid,
        },
      });
      await prisma.realtyThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date() },
      });
      if (!args.skipQuota) await consumeRealtyQuota(args.accountId);

      return { ok: true, messageId: row.id };
    } catch (e) {
      const code = waErrorCode(e);
      const title = e instanceof Error ? e.message : "Meta no pudo entregar el mensaje";
      await prisma.realtyMessage
        .update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            errorCode: code,
            errorTitle: title,
            // 🔴 SE LIBERA LA LLAVE. Al pegarle "#<id>" el externalId deja de
            // TERMINAR en la llave de reclamo, así que el siguiente intento
            // no lo confunde con un envío hecho. El id del propio mensaje
            // como marca: es único, así que dos fallos a la vez no chocan
            // contra @@unique([threadId, externalId]).
            ...(args.claimKey
              ? { externalId: `${claimedExternalId(args.claimKey)}#${row.id}` }
              : {}),
          },
        })
        .catch(() => {});
      return {
        ok: false,
        error: formatWaErrorMessage(code, title),
        reason: "meta",
        code: code ?? undefined,
      };
    }
  } catch (e) {
    console.error("[realty/wa] envío no realizado:", e);
    return { ok: false, error: "No se pudo enviar el mensaje.", reason: "meta" };
  }
}

/**
 * POST crudo a Meta. Copia deliberada de postToGraph (src/lib/whatsapp.ts):
 * aquel solo arma mensajes de texto, plantilla y documento, y aquí hace
 * falta `type: "image"`. Añadir un tipo allá tocaría un archivo compartido y
 * VIVO por ~15 sitios del dental — exactamente lo que esta terminal no hace.
 */
async function postRealtyGraph(
  creds: RealtyWaCredentials,
  payload: Record<string, unknown>,
): Promise<{ wamid: string | null }> {
  const url = `${GRAPH}/${encodeURIComponent(creds.phoneNumberId)}/messages`;
  const doPost = () =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

  let res = await doPost();
  // Un solo reintento y SOLO ante 5xx/429. Nunca ante timeout: no duplicar
  // pesa más que no perder (mismo criterio que el núcleo compartido).
  if (res.status >= 500 || res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await doPost();
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw parseWaError(json, res.status);
  const wamid = json?.messages?.[0]?.id;
  return { wamid: typeof wamid === "string" ? wamid : null };
}

// ═══════════════════════════════════════════════════════════════════════
// A. ENGANCHE AL WEBHOOK COMPARTIDO
// ═══════════════════════════════════════════════════════════════════════

/** Describe en español un mensaje que no es texto y saca el id del archivo. */
function describeRealtyIncoming(msg: any): { body: string; media: RealtyWaMedia | null } | null {
  if (!msg || msg.type === "text") return null;
  const withCaption = (base: string, obj: any) =>
    obj?.caption ? `${base} — ${String(obj.caption)}` : base;

  const media = (kind: RealtyWaMedia["kind"], obj: any): RealtyWaMedia | null =>
    obj?.id
      ? {
          kind,
          mediaId: String(obj.id),
          ...(obj.mime_type ? { mime: String(obj.mime_type) } : {}),
          ...(obj.filename ? { filename: String(obj.filename) } : {}),
        }
      : null;

  switch (msg.type) {
    case "image":
      return { body: withCaption("📷 Te mandaron una foto", msg.image), media: media("image", msg.image) };
    case "video":
      return { body: withCaption("🎥 Te mandaron un video", msg.video), media: media("video", msg.video) };
    case "audio":
      return { body: "🎤 Te mandaron una nota de voz", media: media("audio", msg.audio) };
    case "document":
      return {
        body: withCaption(
          `📄 Te mandaron un archivo${msg.document?.filename ? `: ${msg.document.filename}` : ""}`,
          msg.document,
        ),
        media: media("document", msg.document),
      };
    case "sticker":
      return { body: "🙂 Te mandaron una calcomanía", media: media("sticker", msg.sticker) };
    case "location":
      return { body: "📍 Te mandaron una ubicación", media: null };
    case "contacts":
      return { body: "👤 Te mandaron un contacto", media: null };
    case "reaction":
      return { body: `Reaccionó con ${msg.reaction?.emoji ?? "un emoji"}`, media: null };
    default:
      return { body: "Te mandaron un mensaje que el panel todavía no sabe mostrar", media: null };
  }
}

/**
 * ⭐ PUNTO DE ENTRADA del webhook compartido para los mensajes que ENTRAN.
 *
 * Devuelve false cuando el phone_number_id no es de ninguna cuenta de
 * inmuebles — esa es la señal para que el webhook registre "número sin
 * dueño". NUNCA lanza: el webhook la llama dentro de un try/catch, pero un
 * fallo aquí no puede ni rozar la entrega de un mensaje de una clínica.
 */
export async function ingestRealtyInbound(value: any, msg: any): Promise<boolean> {
  const account = await accountByPhoneNumberId(value?.metadata?.phone_number_id);
  if (!account) return false;

  const phone = mxTenDigits(msg?.from);
  if (!phone) return true; // es nuestro, pero no hay de dónde agarrarlo

  const wamid = typeof msg?.id === "string" ? msg.id : null;
  const rawText = String(
    msg?.text?.body ??
      msg?.interactive?.button_reply?.title ??
      msg?.interactive?.list_reply?.title ??
      msg?.button?.text ??
      "",
  ).trim();
  const incoming = rawText ? null : describeRealtyIncoming(msg);
  if (!rawText && !incoming) return true;

  const thread = await upsertRealtyThread({ accountId: account.id, phone, markUnread: true });
  if (!thread) return true;

  // Dedup por wamid: Meta REENTREGA el webhook ante cualquier respuesta que
  // no sea 200 y ante un timeout. El @@unique([threadId, externalId]) lo
  // garantiza; este findFirst solo evita el trabajo de más.
  if (wamid) {
    const dup = await prisma.realtyMessage.findFirst({
      where: { threadId: thread.id, externalId: wamid },
      select: { id: true },
    });
    if (dup) return true;
  }

  try {
    await prisma.realtyMessage.create({
      data: {
        accountId: account.id,
        threadId: thread.id,
        direction: "INBOUND",
        body: rawText || incoming!.body,
        // El archivo NO se descarga ni se guarda: se anota el id de Meta y se
        // sirve por proxy cuando alguien lo abra (igual que el dental).
        mediaUrl: incoming?.media ? encodeRealtyWaMedia(incoming.media) : null,
        externalId: wamid,
        status: "DELIVERED",
      },
    });
  } catch (e: any) {
    if (e?.code === "P2002") return true; // reentrega de Meta
    throw e;
  }

  // Multimedia: llegó, quedó en el hilo y AQUÍ TERMINA. Una foto no es un
  // "CONFIRMAR" y no puede mover la agenda de nadie.
  if (incoming) return true;

  await applyRealtyReply({
    accountId: account.id,
    threadId: thread.id,
    contactId: thread.contactId,
    text: rawText,
  });

  return true;
}

/**
 * Qué hacer con lo que respondió la persona. Best-effort: si algo de esto
 * falla, el mensaje YA quedó registrado en el hilo y el asesor lo va a ver.
 */
async function applyRealtyReply(args: {
  accountId: string;
  threadId: string;
  contactId: string | null;
  text: string;
}): Promise<void> {
  try {
    const reply = classifyRealtyReply(args.text);
    if (reply === "unclear") return;

    // BAJA: se apaga el aviso de coincidencias de ESE contacto. Es lo que
    // Meta exige de una plantilla de marketing y lo que cualquiera espera.
    if (reply === "optOut") {
      if (!args.contactId) return;
      await prisma.realtySearchProfile.updateMany({
        where: { accountId: args.accountId, contactId: args.contactId },
        data: { notifyByWhatsapp: false },
      });
      return;
    }

    if (!args.contactId) return;

    // La visita a la que se refiere: la más próxima que siga viva. Si hay
    // más de una, NO se adivina — se deja para que la atienda una persona.
    const now = new Date();
    const visits = await prisma.realtyVisit.findMany({
      where: {
        accountId: args.accountId,
        scheduledAt: { gte: now },
        status: { in: ["PROGRAMADA", "CONFIRMADA"] },
        lead: { contactId: args.contactId },
      },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, leadId: true },
      take: 2,
    });
    if (visits.length !== 1) return;
    const visit = visits[0];

    if (reply === "confirm") {
      await prisma.realtyVisit.update({
        where: { id: visit.id },
        data: { status: "CONFIRMADA" },
      });
    } else if (reply === "cancel") {
      await prisma.realtyVisit.update({
        where: { id: visit.id },
        data: { status: "CANCELADA" },
      });
    }
    // "reschedule" NO mueve nada solo: mover una visita necesita una hora
    // nueva y eso lo acuerda el asesor. Queda en el hilo, sin unread perdido.

    if (visit.leadId) {
      await prisma.realtyLeadActivity.create({
        data: {
          accountId: args.accountId,
          leadId: visit.leadId,
          kind: "WHATSAPP",
          note:
            reply === "confirm"
              ? "Confirmó la visita por WhatsApp."
              : reply === "cancel"
                ? "Canceló la visita por WhatsApp."
                : "Pidió cambiar la visita por WhatsApp.",
        },
      });
    }
  } catch (e) {
    console.error("[realty/wa] respuesta no aplicada:", e);
  }
}

/**
 * ⭐ PUNTO DE ENTRADA del webhook para las PALOMITAS (value.statuses[]).
 *
 * Sin esto, un aviso RECHAZADO por Meta se quedaría para siempre pintado
 * como "enviado" — el bug M-06/M-10 del dental. Devuelve false si el número
 * no es de inmuebles.
 */
export async function applyRealtyDeliveryStatuses(
  phoneNumberId: unknown,
  statuses: any[],
): Promise<boolean> {
  const account = await accountByPhoneNumberId(phoneNumberId);
  if (!account) return false;

  for (const st of Array.isArray(statuses) ? statuses : []) {
    const wamid = typeof st?.id === "string" ? st.id : null;
    const raw = typeof st?.status === "string" ? st.status.toUpperCase() : null;
    if (!wamid || !raw) continue;

    try {
      // Las DOS formas por igualdad/prefijo ANCLADO A LA IZQUIERDA, para que
      // las dos usen @@index([externalId]):
      //   · "<wamid>"          → envío a mano o mensaje entrante
      //   · "<wamid>|<llave>"  → envío automático (lleva su idempotencia)
      // Un `endsWith` recorrería la tabla entera en cada palomita: eso es
      // justo lo que el dental documenta como error y aquí no se repite.
      const row = await prisma.realtyMessage.findFirst({
        where: {
          accountId: account.id,
          direction: "OUTBOUND",
          OR: [{ externalId: wamid }, { externalId: { startsWith: `${wamid}|` } }],
        },
        select: { id: true, status: true },
      });
      if (!row) continue;

      const next = nextRealtyWaStatus(row.status, raw);
      if (!next) continue; // repetido, desconocido, o iría hacia atrás

      if (next === "FAILED") {
        const err = Array.isArray(st?.errors) ? st.errors[0] : null;
        const code = typeof err?.code === "number" ? err.code : null;
        const title =
          (typeof err?.title === "string" && err.title) ||
          (typeof err?.message === "string" && err.message) ||
          "Meta no pudo entregar el mensaje";
        await prisma.realtyMessage.update({
          where: { id: row.id },
          data: { status: "FAILED", errorCode: code, errorTitle: title },
        });
        if (code === WA_ERROR_CODE.TOKEN_EXPIRED) {
          // Seguir intentando con un token muerto es el fallo mudo que
          // perseguimos: se apaga la conexión y la pantalla lo dice.
          await prisma.realtyAccount
            .update({ where: { id: account.id }, data: { whatsappVerifiedAt: null } })
            .catch(() => {});
        }
        continue;
      }

      await prisma.realtyMessage.update({ where: { id: row.id }, data: { status: next } });
    } catch (e) {
      console.error("[realty/wa] estado no aplicado:", e);
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// B. RESPUESTA AUTOMÁTICA AL PROSPECTO — la razón de ser de este módulo
// ═══════════════════════════════════════════════════════════════════════

/**
 * Acuse inmediato a un prospecto que acaba de entrar (portal, web, letrero).
 *
 * 🔴 EL DATO DURO: pasados 10 minutos, la probabilidad de contactar al
 * prospecto cae ~80 %. Por eso esto NO se encola: sale en cuanto se crea.
 *
 * Es un ENVOLTORIO de sendRealtyLeadWhatsapp, que es la firma que pidió T3 y
 * por donde entran los tres sitios del CRM. Un solo camino de saludo: si
 * hubiera dos, cada uno con su idempotencia, el prospecto recibiría dos.
 * Aquí solo se arma el trigger a partir del id.
 */
export async function notifyRealtyLead(leadId: string): Promise<RealtyWaSendResult> {
  const lead = await prisma.realtyLead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      accountId: true,
      contactId: true,
      contact: { select: { name: true, phone: true } },
      property: { select: { id: true, title: true } },
      assignedUser: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!lead) return { ok: false, error: "Prospecto no encontrado.", reason: "not_found" };
  if (!lead.contact?.phone) {
    return { ok: false, error: "El prospecto no tiene teléfono.", reason: "phone" };
  }

  const res = await sendRealtyLeadWhatsapp({
    accountId: lead.accountId,
    leadId: lead.id,
    contactId: lead.contactId,
    phone: lead.contact.phone,
    contactName: lead.contact.name,
    source: "panel",
    propertyId: lead.property?.id ?? null,
    propertyTitle: lead.property?.title ?? null,
    reason: "INBOUND_LEAD",
    assignedUserId: lead.assignedUser?.id ?? null,
    assignedUserName: lead.assignedUser
      ? `${lead.assignedUser.firstName} ${lead.assignedUser.lastName}`.trim()
      : null,
  });

  if (res.sent) {
    await prisma.realtyLeadActivity
      .create({
        data: {
          accountId: lead.accountId,
          leadId: lead.id,
          kind: "WHATSAPP",
          note: "Se le mandó el acuse automático por WhatsApp.",
        },
      })
      .catch(() => {});
    return { ok: true, messageId: res.externalId ?? lead.id };
  }

  return {
    ok: false,
    error:
      res.skippedReason === "SIN_CUPO"
        ? "Se acabaron los mensajes incluidos de este periodo."
        : res.skippedReason === "SIN_WHATSAPP"
          ? "Tu plan no incluye WhatsApp o no has conectado un número."
          : "Ese saludo ya se había mandado o no se pudo enviar.",
    reason: res.skippedReason === "SIN_CUPO" ? "quota" : "meta",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// B-bis. LOS ENGANCHES QUE PIDIERON LAS OTRAS TERMINALES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Código de acceso del PORTAL DEL CLIENTE. Es la firma EXACTA que dejó
 * escrita T9 en `src/lib/realty/portal-auth.ts`.
 *
 * Tres requisitos, y los tres los impone Meta o el sentido común:
 *   · plantilla AUTHENTICATION — es lo único que Meta permite para un código
 *     de un solo uso, y llega con botón de "copiar código";
 *   · sale EN EL MOMENTO, nunca por una cola: un código que llega en un
 *     minuto ya no sirve para entrar;
 *   · 🔴 el código NO se guarda en el hilo. La fila de RealtyMessage lleva un
 *     cuerpo NEUTRO. Un código en la base es un código filtrado.
 *
 * Por eso NO pasa por sendRealtyWhatsApp: esa función guarda el cuerpo que
 * manda, y aquí el cuerpo no se puede guardar. Se registra a mano, sin el
 * código, y se descuenta el cupo igual.
 */
export async function sendRealtyPortalCode(args: {
  accountId: string;
  phone: string;
  code: string;
}): Promise<boolean> {
  try {
    const account = await accountById(args.accountId);
    if (!account || !account.isActive) return false;
    if (!(await accountHasWhatsApp(account))) return false;

    const creds = resolveRealtyCredentials(account);
    if (!creds) return false;

    const phone = mxTenDigits(args.phone);
    if (!phone) return false;

    const quota = await getRealtyWaQuota(args.accountId);
    if (!realtyWaFits(quota.limit, quota.used)) return false;

    const tpl = realtyWaTemplate("portalCode");

    // Una plantilla AUTHENTICATION necesita el componente `button` con
    // sub_type "url" además del body — y sendWhatsAppTemplate (el núcleo
    // compartido) solo arma el body. Por eso se manda por postRealtyGraph,
    // igual que hizo barber con su código de acceso: NO se toca la función
    // compartida, de la que dependen ~15 sitios del dental.
    const res = await postRealtyGraph(creds, {
      messaging_product: "whatsapp",
      to: normalizeMxWhatsAppPhone(phone),
      type: "template",
      template: {
        name: tpl.name,
        language: { code: tpl.lang },
        components: [
          { type: "body", parameters: [{ type: "text", text: args.code }] },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: args.code }],
          },
        ],
      },
    });

    // Registro NEUTRO: queda constancia de que se mandó, sin el código.
    const thread = await upsertRealtyThread({ accountId: args.accountId, phone });
    if (thread) {
      await prisma.realtyMessage
        .create({
          data: {
            accountId: args.accountId,
            threadId: thread.id,
            direction: "OUTBOUND",
            body: "Código de acceso al portal (el código no se guarda).",
            templateName: tpl.name,
            externalId: res.wamid,
            status: "SENT",
          },
        })
        .catch(() => {});
    }
    await consumeRealtyQuota(args.accountId);
    return true;
  } catch (e) {
    // Nunca propaga: T9 lo llama desde una función `void` a propósito, para
    // no filtrar si el teléfono existe.
    console.error("[realty/wa] no se pudo mandar el código de acceso:", e);
    return false;
  }
}

/**
 * Saludo automático al prospecto. Es la firma EXACTA
 * (`RealtyLeadWhatsappNotifier`) que dejó escrita T3 en
 * `src/lib/realty/inbound-mail.ts`, y la usan los TRES sitios que crean o
 * avisan un prospecto: el alta manual, el correo de portal y el botón de
 * "avísales de este inmueble".
 *
 * El trigger trae TODO ya resuelto a propósito, así que aquí no se vuelve a
 * consultar la base más que para el nombre de la cuenta.
 *
 * 🔴 NUNCA lanza. Perder el aviso es malo; perder el prospecto es peor.
 */
export async function sendRealtyLeadWhatsapp(
  trigger: RealtyLeadWhatsappTrigger,
): Promise<RealtyLeadWhatsappResult> {
  try {
    const phone = trigger.phone ? mxTenDigits(trigger.phone) : null;
    if (!phone) return { sent: false, skippedReason: "SIN_TELEFONO" };

    const account = await accountById(trigger.accountId);
    if (!account) return { sent: false, skippedReason: "ERROR" };

    const nombre = firstWord(trigger.contactName) || "hola";
    const inmueble = trigger.propertyTitle || "el inmueble que viste";
    const esMatch = trigger.reason === "MATCH_NUEVA_PROPIEDAD";

    // 🔴 El aviso de coincidencia es COLD OUTREACH: por definición se le manda
    // a alguien que NO escribió hoy, así que la ventana de 24 h está cerrada
    // casi siempre y hace falta la plantilla CON sus cinco datos. Mandar
    // `params: null` hacía que este camino fallara SIEMPRE con "params", que
    // además se traducía a ERROR y hacía que el panel dijera "el emisor de
    // WhatsApp todavía no está conectado" — una mentira.
    const prop = esMatch && trigger.propertyId
      ? await prisma.realtyProperty.findFirst({
          where: { id: trigger.propertyId, accountId: trigger.accountId },
          select: {
            id: true,
            title: true,
            operation: true,
            price: true,
            rentPrice: true,
            currency: true,
            colonia: true,
            city: true,
            isPublished: true,
            publicUrlSlug: true,
          },
        })
      : null;
    const zona = prop?.colonia || prop?.city || "la zona que buscas";
    const precio = prop
      ? formatRealtyWaPrice(
          Number(prop.operation === "RENTA" ? (prop.rentPrice ?? prop.price) : prop.price),
          prop.currency,
        )
      : "";
    const liga = prop ? propertyPublicUrl(account.slug, prop) : null;

    const result = esMatch
      ? await sendRealtyWhatsApp({
          accountId: trigger.accountId,
          phone,
          contactId: trigger.contactId,
          kind: "matchAlert",
          // Sin inmueble publicado no hay liga que enseñar, y sin liga la
          // plantilla no cuadra: entonces solo se puede mandar dentro de la
          // ventana. Es honesto y se reporta como tal.
          params: prop && liga ? [nombre, prop.title, zona, precio, liga] : null,
          body:
            "Hola " + nombre + ", entró algo que encaja con lo que buscas: " + inmueble +
            (precio ? " por " + precio : "") + "." +
            (liga ? " Míralo aquí: " + liga : "") +
            "\n\nResponde BAJA si no quieres más avisos.",
          claimKey: realtyMatchClaimKey(trigger.propertyId ?? "sin-inmueble", trigger.contactId),
        })
      : await sendRealtyWhatsApp({
          accountId: trigger.accountId,
          phone,
          contactId: trigger.contactId,
          kind: "leadAck",
          params: [nombre, inmueble, trigger.assignedUserName || account.name, account.name],
          body:
            "Hola " + nombre + ", gracias por tu interés en " + inmueble + ". Soy " +
            (trigger.assignedUserName || account.name) + ", de " + account.name +
            ", y te atiendo por aquí mismo. ¿Qué te gustaría saber?",
          // Idempotente por prospecto: dos correos del mismo portal no
          // saludan dos veces a la misma persona.
          claimKey: buildRealtyClaimKey("leadAck", trigger.leadId),
        });

    if (isRealtyWaSendOk(result)) {
      // El reloj del negocio: solo si estaba vacío (el contrato dice que
      // firstResponseAt no se vuelve a escribir).
      await prisma.realtyLead
        .updateMany({
          // accountId además del id: esta función es exportada y el trigger
          // llega de fuera. Un leadId de otra cuenta no puede escribir en su
          // embudo aunque quien llame se equivoque.
          where: { id: trigger.leadId, accountId: trigger.accountId, firstResponseAt: null },
          data: { firstResponseAt: new Date() },
        })
        .catch(() => {});
      const row = await prisma.realtyMessage
        .findUnique({ where: { id: result.messageId }, select: { externalId: true } })
        .catch(() => null);
      // El centinela "sin-wamid" NO es un wamid: es lo que se escribe cuando
      // Meta contesta 200 sin id. Devolverlo sería inventarse un folio.
      const wamid = wamidFromExternalId(row?.externalId);
      return wamid && wamid !== "sin-wamid" ? { sent: true, externalId: wamid } : { sent: true };
    }

    // Se traduce MI motivo al vocabulario del contrato de T3.
    const reason = isRealtyWaSendErr(result) ? result.reason : "meta";
    if (reason === "quota") return { sent: false, skippedReason: "SIN_CUPO" };
    if (reason === "plan" || reason === "not_connected") {
      return { sent: false, skippedReason: "SIN_WHATSAPP" };
    }
    if (reason === "phone") return { sent: false, skippedReason: "SIN_TELEFONO" };
    // "duplicate" no es un error: ya se había saludado a ese prospecto. Se
    // devuelve sin motivo, que el llamador registra como "SKIPPED".
    if (reason === "duplicate") return { sent: false };
    return { sent: false, skippedReason: "ERROR" };
  } catch (e) {
    console.error("[realty/wa] saludo al prospecto no enviado:", e);
    return { sent: false, skippedReason: "ERROR" };
  }
}

// ═══════════════════════════════════════════════════════════════════════
// C. FICHA DEL INMUEBLE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Manda la ficha de un inmueble: foto de portada, precio, datos y la liga a
 * la web (y al recorrido si lo hay). Es lo que el asesor hace 20 veces al
 * día y hoy lo resuelve copiando y pegando.
 *
 * Dentro de la ventana de 24 h sale como IMAGEN con pie, que es lo que se
 * ve bien en el teléfono. Fuera de ella sale la plantilla con la liga: Meta
 * no deja mandar una imagen suelta a alguien que no escribió.
 */
export async function sendRealtyPropertyCard(args: {
  accountId: string;
  propertyId: string;
  phone: string;
  contactId?: string | null;
}): Promise<RealtyWaSendResult> {
  const property = await prisma.realtyProperty.findFirst({
    where: { id: args.propertyId, accountId: args.accountId },
    select: {
      id: true,
      title: true,
      price: true,
      rentPrice: true,
      currency: true,
      operation: true,
      bedrooms: true,
      bathrooms: true,
      parking: true,
      builtM2: true,
      colonia: true,
      city: true,
      isPublished: true,
      publicUrlSlug: true,
      photos: {
        where: { isCover: true },
        select: { url: true },
        take: 1,
      },
      tours: { select: { externalUrl: true, fileUrl: true }, orderBy: { sortOrder: "asc" }, take: 1 },
      account: { select: { slug: true, name: true } },
    },
  });
  if (!property) return { ok: false, error: "Inmueble no encontrado.", reason: "not_found" };

  const contact = args.contactId
    ? await prisma.realtyContact.findFirst({
        where: { id: args.contactId, accountId: args.accountId },
        select: { name: true },
      })
    : null;
  const nombre = firstWord(contact?.name ?? "") || "¿qué tal?";

  const precioNum = Number(
    property.operation === "RENTA" ? (property.rentPrice ?? property.price) : property.price,
  );
  const precio = formatRealtyWaPrice(precioNum, property.currency);
  const liga = propertyPublicUrl(property.account.slug, property);

  const detalles = [
    property.bedrooms ? `${property.bedrooms} rec.` : null,
    property.bathrooms ? `${property.bathrooms} baños` : null,
    property.parking ? `${property.parking} autos` : null,
    property.builtM2 ? `${Number(property.builtM2)} m² construidos` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const tour = property.tours[0]?.externalUrl || property.tours[0]?.fileUrl || null;
  const ubicacion = [property.colonia, property.city].filter(Boolean).join(", ");

  const body = [
    `${property.title}`,
    ubicacion ? `📍 ${ubicacion}` : null,
    `💰 ${precio}`,
    detalles || null,
    liga ? `Ver ficha: ${liga}` : null,
    tour ? `Recorrido virtual: ${tour}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return sendRealtyWhatsApp({
    accountId: args.accountId,
    phone: args.phone,
    contactId: args.contactId ?? null,
    kind: "propertyCard",
    // La plantilla necesita una liga NO vacía: si el inmueble no está
    // publicado no hay página que enseñar, y decirlo es mejor que mandar una
    // liga rota. Sin liga solo se puede mandar dentro de la ventana.
    params: liga ? [nombre, property.title, precio, liga] : null,
    body,
    imageUrl: metaFetchableImage(property.photos[0]?.url),
  });
}

/**
 * Liga pública del inmueble. null si NO está publicado: un inmueble sin
 * publicar no tiene página, y mandar una liga muerta es peor que no mandarla.
 */
function propertyPublicUrl(
  accountSlug: string,
  property: { isPublished: boolean; publicUrlSlug: string | null; id: string },
): string | null {
  if (!property.isPublished) return null;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";
  return `${site}${REALTY_PUBLIC_BASE}/${accountSlug}/${property.publicUrlSlug ?? property.id}`;
}

function firstWord(name: string): string {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * La foto que se le puede mandar a Meta, o null.
 *
 * 🔴 Meta descarga la imagen ÉL MISMO desde el `link`, así que tiene que ser
 * https y alcanzable SIN sesión. El bucket `realty-files` es PRIVADO (lo dice
 * el schema), así que una ruta de storage a secas NO sirve: Meta recibiría un
 * 403 y el envío entero fallaría por la foto.
 *
 * Con esto, un inmueble cuya foto no es pública manda el mensaje IGUAL, solo
 * que sin imagen — el texto ya lleva el precio, los datos y la liga. Vale
 * mil veces más un mensaje sin foto que ningún mensaje.
 */
function metaFetchableImage(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const clean = url.trim();
  // Solo https absoluto. Una URL firmada de Supabase cumple; una ruta
  // relativa o un http:// pelado, no.
  return clean.startsWith("https://") ? clean : null;
}

// ═══════════════════════════════════════════════════════════════════════
// D. RECORDATORIO DE VISITA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Manda los recordatorios de visita que toquen. Lo llama el cron y también
 * el botón del panel.
 *
 * 🔴 EL BUG M-22 DEL DENTAL NO PUEDE PASAR AQUÍ, y no por disciplina sino
 * por construcción:
 *   · nada se encola con la hora congelada dentro del texto — el mensaje se
 *     arma AQUÍ, leyendo la visita viva, justo antes de mandarlo;
 *   · la llave de idempotencia LLEVA DENTRO la hora programada
 *     (realtyVisitClaimKey). Si la visita se reagenda, la llave cambia: el
 *     aviso viejo queda como historia y el nuevo sale con la hora nueva, sin
 *     que el viejo lo bloquee.
 * Además, quien reagenda debe llamar a cancelRealtyVisitReminders para que
 * un aviso todavía sin mandar no salga con la hora anterior.
 */
/**
 * Cierra las filas que se quedaron RECLAMADAS y nunca se resolvieron.
 *
 * POR QUÉ EXISTE: sendRealtyWhatsApp reclama la fila (PENDING) ANTES de
 * llamar a Meta, para que dos crones a la vez no manden dos veces. Si el
 * proceso se muere entre el reclamo y la respuesta de Meta (un timeout de
 * la función), la fila se queda en PENDING para siempre y el panel enseña
 * un mensaje "pendiente" que ya nunca va a cambiar.
 *
 * 🔴 NO se reintenta, y es a propósito: no sabemos si Meta llegó a recibirlo,
 * y mandar dos veces un cobro de renta es peor que no mandarlo. Lo que sí se
 * hace es DECIR LA VERDAD — la fila pasa a FAILED con el motivo real, para
 * que quien la vea sepa que hay que revisarla a mano en vez de creer que
 * está por salir.
 */
const STALE_PENDING_MS = 30 * 60 * 1000;

/**
 * Marca que llevan DENTRO del externalId todos los avisos de coincidencia
 * (realtyMatchClaimKey empieza por "matchAlert:"). Es lo que se cuenta para
 * los topes: está presente salga como plantilla o como texto libre.
 */
const MATCH_CLAIM_MARK = "matchAlert:";

export async function expireStaleRealtyPending(accountId?: string): Promise<number> {
  try {
    const stuck = await prisma.realtyMessage.findMany({
      where: {
        ...(accountId ? { accountId } : {}),
        direction: "OUTBOUND",
        status: "PENDING",
        createdAt: { lt: new Date(Date.now() - STALE_PENDING_MS) },
      },
      select: { id: true, externalId: true },
      take: 500,
    });

    let closed = 0;
    for (const row of stuck) {
      // Se libera la llave igual que en el catch del envío (ver ahí el
      // porqué): si no, un reclamo que se murió a medias bloquearía ese
      // aviso para siempre.
      const freed =
        row.externalId && row.externalId.startsWith(REALTY_WA_PENDING_MARK)
          ? `${row.externalId}#${row.id}`
          : row.externalId;
      await prisma.realtyMessage
        .update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            errorTitle: "No se pudo confirmar el envío con WhatsApp. Revísalo a mano.",
            externalId: freed,
          },
        })
        .then(() => { closed++; })
        .catch(() => {});
    }
    return closed;
  } catch (e) {
    console.error("[realty/wa] no se pudieron cerrar los pendientes viejos:", e);
    return 0;
  }
}

export async function sendRealtyVisitReminders(
  accountId?: string,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = new Date();
  const visits = await prisma.realtyVisit.findMany({
    where: {
      ...(accountId ? { accountId } : {}),
      status: { in: ["PROGRAMADA", "CONFIRMADA"] },
      scheduledAt: {
        gte: new Date(now.getTime() + VISIT_MIN_LEAD_MS),
        lte: new Date(now.getTime() + VISIT_MAX_LEAD_MS),
      },
    },
    select: {
      id: true,
      accountId: true,
      scheduledAt: true,
      account: { select: { timezone: true } },
      property: { select: { title: true, colonia: true, city: true } },
      lead: { select: { contactId: true, contact: { select: { name: true, phone: true } } } },
    },
    take: 300,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const visit of visits) {
    const phone = visit.lead?.contact?.phone;
    if (!phone) {
      skipped++;
      continue;
    }
    const nombre = firstWord(visit.lead!.contact!.name) || "¿qué tal?";
    const inmueble = visit.property.title;
    // 🔴 En la zona de la CUENTA: en Vercel el servidor corre en UTC y una
    //    visita de las 11:00 en Guadalajara se anunciaba como las 17:00.
    const tz = visit.account.timezone;
    const fecha = formatRealtyWaLongDate(visit.scheduledAt, tz);
    const hora = formatRealtyWaTime(visit.scheduledAt, tz);

    const result = await sendRealtyWhatsApp({
      accountId: visit.accountId,
      phone,
      contactId: visit.lead?.contactId ?? null,
      kind: "visitReminder",
      params: [nombre, inmueble, fecha, hora],
      body:
        `Hola ${nombre}, te recordamos tu visita a ${inmueble} el ${fecha} a las ${hora}. ` +
        "Responde CONFIRMAR, CANCELAR o CAMBIAR.",
      claimKey: realtyVisitClaimKey(visit.id, visit.scheduledAt),
    });

    if (result.ok) sent++;
    else if (isRealtyWaSendErr(result) && result.reason === "duplicate") skipped++;
    else failed++;
  }

  return { sent, failed, skipped };
}

/**
 * Cancela los recordatorios de una visita que TODAVÍA no salieron. Lo llama
 * quien reagenda o cancela la visita.
 *
 * ⚠️ ESTO ES EL CINTURÓN, NO LOS TIRANTES. El envío es SÍNCRONO: no hay cola,
 * así que una fila está en PENDING solo los milisegundos entre que se reclama
 * y que Meta contesta. En la práctica esto devuelve 0 casi siempre, y está
 * bien — quien de verdad impide que salga el aviso con la hora vieja es la
 * LLAVE DE RECLAMO, que lleva la hora dentro (ver sendRealtyVisitReminders).
 * Esto solo barre el caso raro de una función que se murió a medio envío.
 *
 * Solo toca filas PENDING: una que ya se mandó es historia y además es
 * contra la que se cruzan las respuestas del prospecto. Borrarla dejaría un
 * "CONFIRMAR" sin nada a lo que referirse — el error que el dental cometió
 * y luego arregló.
 */
export async function cancelRealtyVisitReminders(args: {
  accountId: string;
  visitId: string;
}): Promise<number> {
  try {
    const res = await prisma.realtyMessage.updateMany({
      where: {
        accountId: args.accountId,
        status: "PENDING",
        direction: "OUTBOUND",
        externalId: { contains: `visitReminder:${args.visitId}:` },
      },
      data: {
        status: "FAILED",
        errorTitle: "Cancelado: la visita se movió y este aviso llevaba la hora anterior",
      },
    });
    return res.count;
  } catch (e) {
    console.error("[realty/wa] no se pudieron cancelar los recordatorios:", e);
    return 0;
  }
}


// ═══════════════════════════════════════════════════════════════════════
// E. AVISOS DE COBRO DE RENTA
// ═══════════════════════════════════════════════════════════════════════

/**
 * Manda por WhatsApp UN aviso de cobro de la cola de T4.
 *
 * 🔴 LA COLA NO ES MÍA Y NO DEBE SERLO. Quien decide qué avisos tocan hoy,
 * cuánto se debe (saldo en CENTAVOS, no el cargo), si el cargo va PARCIAL o
 * PAGADO y por qué canal sale es `buildRentNoticeQueue` /
 * `deliverRentNotice` (src/lib/realty/leases.ts). Esta terminal escribió al
 * principio su propio barrido de rentas; cuando T4 aterrizó quedó claro que
 * eran DOS colas para el mismo cobro, con dos llaves de idempotencia
 * distintas — o sea, dos WhatsApps al mismo inquilino. Se borró la mía.
 *
 * El canal ya viene recortado por el plan (`noticeChannelsFor`): al plan
 * PROPIETARIO, que no incluye WhatsApp, esto ni le llega.
 *
 * Devuelve true solo si Meta lo aceptó.
 */
export async function sendRentNoticeWhatsapp(notice: {
  key: string;
  accountId: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string | null;
  periodLabel: string;
  dueAt: string;
  daysLate: number;
  balanceCents: number;
  currency: string;
  message: string;
}): Promise<boolean> {
  if (!notice.contactPhone) return false;

  const account = await accountById(notice.accountId);
  if (!account) return false;

  const vencido = notice.daysLate > 0;
  const nombre = firstWord(notice.contactName) || "hola";
  // El saldo viene en CENTAVOS. La conversión se hace con el helper de T4 y
  // no con un `/ 100` a mano: si algún día cambian la convención del dinero
  // del vertical, este mensaje la sigue sola en vez de quedarse mintiendo
  // sobre cuánto debe el inquilino.
  const { centsToNumber } = await import("@/lib/realty/rent-charges");
  const monto = formatRealtyWaPrice(centsToNumber(notice.balanceCents), notice.currency);
  const fecha = formatRealtyWaDate(new Date(notice.dueAt), account.timezone);

  const result = await sendRealtyWhatsApp({
    accountId: notice.accountId,
    phone: notice.contactPhone,
    contactId: notice.contactId,
    kind: vencido ? "rentOverdue" : "rentUpcoming",
    params: vencido
      ? [nombre, notice.periodLabel, monto, fecha, String(notice.daysLate)]
      : [nombre, notice.periodLabel, monto, fecha],
    // El texto ya lo escribió T4 en español de México; se respeta.
    body: notice.message,
    // La llave de T4, no una propia.
    claimKey: notice.key,
  });

  return isRealtyWaSendOk(result);
}

// ═══════════════════════════════════════════════════════════════════════
// F. MATCH AUTOMÁTICO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cuando entra un inmueble a la cartera, avisa a quien lo estaba buscando.
 *
 * 🔴 EL CRUCE NO SE HACE AQUÍ. Lo hace `findSeekersForProperty`
 * (src/lib/realty/leads.ts), que es el PUNTO ÚNICO del match del vertical:
 * puntúa con pesos, respeta una tolerancia de presupuesto, exige un puntaje
 * mínimo y —esto importa— descarta a los prospectos en CIERRE o PERDIDO.
 * Avisarle de un inmueble nuevo a alguien que ya cerró es justo el mensaje
 * que hace que la gente apague los avisos. Esta terminal solo MANDA; el
 * propio tipo `RealtyMatchSeeker` lo dice: "el envío lo hace T6".
 *
 * Es lo ÚNICO del vertical que le escribe a alguien que no preguntó hoy, y
 * por eso lleva tres frenos encima del match:
 *   1. `notifyByWhatsapp` del perfil de búsqueda — nadie entra por default;
 *   2. tope DIARIO por cuenta (REALTY_MATCH_DAILY_CAP): cargar 40 inmuebles
 *      de golpe no puede convertirse en 40 WhatsApps;
 *   3. tope diario POR PERSONA: dos avisos al día como máximo.
 * Y la plantilla es MARKETING con línea de baja, que se atiende de verdad
 * en applyRealtyReply.
 */
export async function notifyRealtyMatches(
  propertyId: string,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const owned = await prisma.realtyProperty.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      accountId: true,
      isPublished: true,
      publicUrlSlug: true,
      account: { select: { slug: true, timezone: true } },
    },
  });
  if (!owned) return { sent: 0, failed: 0, skipped: 0 };

  const { findSeekersForProperty } = await import("@/lib/realty/leads");
  // Alcance de SISTEMA: esto no lo dispara una persona, así que se cruza
  // contra el embudo entero de la cuenta. leadScopeWhere solo recorta a un
  // AGENT sin leads.assign; con OWNER devuelve la cuenta completa.
  // La MISMA tolerancia que usa la pantalla de "quién busca esto". Sin esto,
  // una cuenta con tolerancia al 25 % veía en el panel una lista más larga
  // que la que recibía el aviso — otra vez dos criterios para lo mismo.
  const { getLeadRoutingConfig } = await import("@/lib/realty/leads");
  const routing = await getLeadRoutingConfig(owned.accountId).catch(() => null);

  const found = await findSeekersForProperty(
    owned.accountId,
    propertyId,
    { role: "OWNER", realtyUserId: "", permissionsOverride: [] },
    routing?.matchTolerancePct ? { tolerancePct: routing.matchTolerancePct } : {},
  );
  if (!found || found.matches.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  const property = found.property;
  const precioNum =
    property.operation === "RENTA" ? (property.rentPrice ?? property.price) : property.price;
  const precio = formatRealtyWaPrice(Number(precioNum), property.currency);
  const zona = property.colonia || property.city || "la zona que buscas";
  const liga = propertyPublicUrl(owned.account.slug, owned);

  // Medianoche EN LA ZONA DE LA CUENTA: con la del servidor (UTC en Vercel)
  // el tope diario se reiniciaba a las 18:00 hora de México.
  const dayStart = startOfDayInTz(new Date(), owned.account.timezone);

  const sentToday = await prisma.realtyMessage.count({
    where: {
      accountId: owned.accountId,
      direction: "OUTBOUND",
      // 🔴 Se cuenta por la LLAVE DE RECLAMO, no por templateName. Dentro de
      // la ventana de 24 h el aviso sale como texto libre y se guarda con
      // templateName en NULL: contando por plantilla, los dos topes se
      // quedaban en cero justo cuando más falta hacen.
      externalId: { contains: MATCH_CLAIM_MARK },
      createdAt: { gte: dayStart },
    },
  });
  let budget = Math.max(0, REALTY_MATCH_DAILY_CAP - sentToday);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const match of found.matches) {
    const seeker = match.seeker;
    // El match ya se hizo; aquí solo se RESPETA la preferencia.
    if (!seeker.notifyByWhatsapp) {
      skipped++;
      continue;
    }
    if (budget <= 0) {
      skipped++;
      continue;
    }

    const contact = await prisma.realtyContact.findFirst({
      where: { id: seeker.contactId, accountId: owned.accountId },
      select: { phone: true },
    });
    const phone = contact?.phone ? mxTenDigits(contact.phone) : null;
    if (!phone) {
      skipped++;
      continue;
    }

    // Tope por PERSONA, sobre el hilo de su teléfono.
    const perContact = await prisma.realtyMessage.count({
      where: {
        accountId: owned.accountId,
        direction: "OUTBOUND",
        externalId: { contains: MATCH_CLAIM_MARK },
        createdAt: { gte: dayStart },
        thread: { phone },
      },
    });
    if (perContact >= REALTY_MATCH_PER_CONTACT_DAILY_CAP) {
      skipped++;
      continue;
    }

    const nombre = firstWord(seeker.name) || "¿qué tal?";
    const result = await sendRealtyWhatsApp({
      accountId: owned.accountId,
      phone,
      contactId: seeker.contactId,
      kind: "matchAlert",
      params: liga ? [nombre, property.title, zona, precio, liga] : null,
      body:
        `Hola ${nombre}, entró algo que encaja con lo que buscas: ${property.title} en ${zona} ` +
        `por ${precio}.${liga ? ` Míralo aquí: ${liga}` : ""}

Responde BAJA si no quieres más avisos.`,
      claimKey: realtyMatchClaimKey(property.id, seeker.contactId),
    });

    if (result.ok) {
      sent++;
      budget--;
    } else if (isRealtyWaSendErr(result) && result.reason === "duplicate") skipped++;
    else failed++;
  }

  return { sent, failed, skipped };
}

// ═══════════════════════════════════════════════════════════════════════
// G. INBOX
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lista de hilos. Trae el ÚLTIMO mensaje de cada uno CON su estado de
 * entrega y su error: sin eso la lista pinta una palomita a un mensaje que
 * Meta rechazó, que es exactamente el bug que arrastraba el dental.
 */
export async function listRealtyThreads(
  accountId: string,
  opts: { archived?: boolean; limit?: number } = {},
): Promise<RealtyWaThreadRowDTO[]> {
  const threads = await prisma.realtyThread.findMany({
    where: { accountId, archived: opts.archived ?? false },
    orderBy: { lastMessageAt: "desc" },
    take: Math.min(opts.limit ?? 100, 200),
    select: {
      id: true,
      contactId: true,
      phone: true,
      lastMessageAt: true,
      unread: true,
      archived: true,
      contact: { select: { name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          body: true,
          direction: true,
          // 🔴 Los campos de entrega VIENEN EN EL SELECT. En el dental
          // faltaban y un mensaje RECHAZADO por Meta se pintaba entregado.
          status: true,
          errorCode: true,
          errorTitle: true,
        },
      },
    },
  });

  const ids = threads.map((t) => t.id);
  // Último ENTRANTE por hilo en UNA sola consulta: la ventana de 24 h de
  // cada fila sin un N+1.
  const inbound = ids.length
    ? await prisma.realtyMessage.groupBy({
        by: ["threadId"],
        where: { threadId: { in: ids }, direction: "INBOUND" },
        _max: { createdAt: true },
      })
    : [];
  const lastIn = new Map(inbound.map((r) => [r.threadId, r._max.createdAt]));

  return threads.map((t) => {
    const last = t.messages[0] ?? null;
    return {
      id: t.id,
      contactId: t.contactId,
      contactName: t.contact?.name ?? null,
      phone: t.phone,
      lastMessageAt: t.lastMessageAt.toISOString(),
      unread: t.unread,
      archived: t.archived,
      lastBody: last?.body ?? null,
      lastDirection: last?.direction ?? null,
      lastStatus: last?.status ?? null,
      lastError:
        last?.status === "FAILED"
          ? formatWaErrorMessage(last.errorCode ?? null, last.errorTitle ?? "No se entregó")
          : null,
      windowOpen: realtyWaWindowOpen(lastIn.get(t.id) ?? null),
    };
  });
}

/**
 * Mensajes de un hilo. El select trae TODOS los campos de entrega: es lo
 * que hace posible pintar la verdad y no una palomita optimista.
 */
export async function listRealtyThreadMessages(
  accountId: string,
  threadId: string,
  limit = 200,
): Promise<{
  messages: RealtyMessageDTO[];
  windowOpen: boolean;
  contactId: string | null;
  contactName: string | null;
  phone: string | null;
}> {
  const thread = await prisma.realtyThread.findFirst({
    where: { id: threadId, accountId },
    select: { id: true, phone: true, contactId: true, contact: { select: { name: true } } },
  });
  if (!thread) {
    return { messages: [], windowOpen: false, contactId: null, contactName: null, phone: null };
  }

  const rows = await prisma.realtyMessage.findMany({
    where: { threadId: thread.id, accountId },
    orderBy: { createdAt: "asc" },
    take: Math.min(limit, 500),
    select: {
      id: true,
      threadId: true,
      direction: true,
      body: true,
      mediaUrl: true,
      templateName: true,
      externalId: true,
      status: true,
      errorCode: true,
      errorTitle: true,
      createdAt: true,
    },
  });

  return {
    messages: rows.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      direction: m.direction,
      body: m.body,
      mediaUrl: m.mediaUrl,
      templateName: m.templateName,
      externalId: m.externalId,
      status: m.status,
      errorCode: m.errorCode,
      errorTitle: m.errorTitle,
      createdAt: m.createdAt.toISOString(),
    })),
    windowOpen: realtyWaWindowOpen(await lastInboundAt(thread.id)),
    contactId: thread.contactId,
    contactName: thread.contact?.name ?? null,
    phone: thread.phone,
  };
}

export async function setRealtyThreadArchived(
  accountId: string,
  threadId: string,
  archived: boolean,
): Promise<boolean> {
  const res = await prisma.realtyThread.updateMany({
    where: { id: threadId, accountId },
    data: { archived },
  });
  return res.count > 0;
}

/**
 * Marca el hilo como leído y, de paso, le pone las palomitas azules al
 * último entrante. El aviso a Meta es best-effort: que no se pueda marcar
 * como leído allá no puede impedir que se marque aquí.
 */
export async function markRealtyThreadRead(accountId: string, threadId: string): Promise<boolean> {
  const res = await prisma.realtyThread.updateMany({
    where: { id: threadId, accountId },
    data: { unread: 0 },
  });
  if (res.count === 0) return false;

  try {
    const account = await accountById(accountId);
    const creds = account ? resolveRealtyCredentials(account) : null;
    if (!creds) return true;
    const lastIn = await prisma.realtyMessage.findFirst({
      where: { threadId, direction: "INBOUND", externalId: { startsWith: "wamid." } },
      orderBy: { createdAt: "desc" },
      select: { externalId: true },
    });
    if (lastIn?.externalId) {
      await markWhatsAppMessageRead(creds.phoneNumberId, creds.accessToken, lastIn.externalId);
    }
  } catch {
    // Las palomitas azules son un adorno: nunca tumban el "marcar leído".
  }
  return true;
}

/** Respuesta a mano desde el Inbox. Pasa por el MISMO camino de envío. */
export async function sendRealtyManualMessage(args: {
  accountId: string;
  threadId: string;
  body: string;
}): Promise<RealtyWaSendResult> {
  const thread = await prisma.realtyThread.findFirst({
    where: { id: args.threadId, accountId: args.accountId },
    select: { phone: true, contactId: true },
  });
  if (!thread) return { ok: false, error: "Conversación no encontrada.", reason: "not_found" };

  const body = String(args.body ?? "").trim();
  if (!body) return { ok: false, error: "El mensaje está vacío.", reason: "params" };
  if (body.length > 4000) return { ok: false, error: "El mensaje es demasiado largo.", reason: "params" };

  return sendRealtyWhatsApp({
    accountId: args.accountId,
    phone: thread.phone,
    contactId: thread.contactId,
    body,
    // Sin `kind`: una respuesta a mano fuera de la ventana no se convierte
    // sola en una plantilla que la inmobiliaria no escribió.
    kind: null,
  });
}

// ── Multimedia por proxy (sin guardar nada) ─────────────────────────────

export interface RealtyMediaOk {
  ok: true;
  url: string;
  mimeType: string;
  filename: string | null;
  token: string;
}
export interface RealtyMediaErr {
  ok: false;
  reason: "not_found" | "expired" | "not_connected" | "upstream";
}
export type RealtyMediaResult = RealtyMediaOk | RealtyMediaErr;

/** Guardas explícitas: con strict:false TS no estrecha por un booleano. */
export function isRealtyMediaOk(result: RealtyMediaResult): result is RealtyMediaOk {
  return result.ok === true;
}

/**
 * Resuelve el archivo de un mensaje para servirlo POR PROXY, sin guardarlo
 * en Storage. Se indexa por messageId y NO por mediaId a propósito: con el
 * id del archivo en la URL, cualquiera con un id ajeno sacaría el archivo de
 * OTRA cuenta usando NUESTRO token. Con el messageId, el filtro por
 * accountId de la sesión lo impide de raíz.
 */
export async function resolveRealtyMedia(
  accountId: string,
  messageId: string,
): Promise<RealtyMediaResult> {
  const message = await prisma.realtyMessage.findFirst({
    where: { id: messageId, accountId },
    select: { mediaUrl: true },
  });
  if (!message) return { ok: false, reason: "not_found" };

  const media = parseRealtyWaMedia(message.mediaUrl);
  if (!media) return { ok: false, reason: "not_found" };

  const account = await accountById(accountId);
  const creds = account ? resolveRealtyCredentials(account) : null;
  if (!creds) return { ok: false, reason: "not_connected" };

  try {
    const meta = await getWhatsAppMediaMeta(creds.accessToken, media.mediaId);
    // null = Meta ya lo borró (los guarda ~30 días). No es "roto": es que ya
    // no existe, y la pantalla lo tiene que decir así.
    if (!meta) return { ok: false, reason: "expired" };
    return {
      ok: true,
      url: meta.url,
      mimeType: meta.mimeType || media.mime || "application/octet-stream",
      filename: media.filename ?? null,
      token: creds.accessToken,
    };
  } catch (e) {
    console.error(`[realty/wa] no se pudo resolver el archivo (${messageId}):`, e);
    return { ok: false, reason: "upstream" };
  }
}
