import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { decryptField, encryptField } from "@/lib/crypto/envelope";
import {
  getWhatsAppMediaMeta,
  markWhatsAppMessageRead,
  normalizeMxWhatsAppPhone,
} from "@/lib/whatsapp";
import { parseWaError, WA_ERROR_CODE, WhatsAppApiError } from "@/lib/whatsapp/errors";
import { mxTenDigits } from "@/lib/phone-mx";
import { getBarberPlan } from "@/lib/barber/plans";
import { isBarbershopSubscriptionActive, barberPlanHasFeature } from "@/lib/barber/plan-shared";
import {
  BARBER_WALKIN_NOTIFY_TEMPLATE,
  isInvalidatedReminder,
  pendingReminderInvalidationWhere,
  reminderInvalidationData,
} from "@/lib/barber/agenda";
import { canTransition, type BarberAppointmentStatus } from "@/lib/barber/types";
import {
  BARBER_WA_ARCHIVE_MARK,
  BARBER_WA_LANG,
  BARBER_WA_TEMPLATES,
  BARBER_WA_UNARCHIVE_MARK,
  barberWaFits,
  barberWaTemplate,
  barberWaWindowOpen,
  buildBarberWaQuota,
  classifyBarberReply,
  countBarberWaVariables,
  encodeBarberWaAttachment,
  isBarberWaSysRow,
  nextBarberWaStatus,
  parseBarberWaAttachment,
  reminderAlreadyHandled,
  type BarberWaAttachment,
  type BarberWaAttachmentKind,
  type BarberWaConnectionDTO,
  type BarberWaConnectionState,
  type BarberWaKind,
  type BarberWaMessageDTO,
  type BarberWaQuotaDTO,
  type BarberWaTemplate,
  type BarberWaThreadDTO,
} from "@/lib/barber/whatsapp-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — WhatsApp (SERVIDOR).
   ═══════════════════════════════════════════════════════════════════════

   Es EL diferenciador del producto: en México WhatsApp es el canal y la
   competencia no lo resuelve (Booksy/Squire/Vagaro no lo tienen, Fresha da
   20 mensajes al mes, AgendaPro lo revende, Amyra cobra $2,499/mes).
   Nosotros lo incluimos.

   ── AISLAMIENTO DEL DENTAL (lo más importante de este archivo) ─────────
   DaleControl Dental está VIVO en producción con clínicas pagando y su
   WhatsApp está aprobado por Meta. Este módulo:
     · NO modifica src/lib/whatsapp.ts — solo IMPORTA de él lo que ya era
       genérico (normalizar teléfono, leer multimedia, marcar leído). El
       POST de mensajes se reimplementa aquí a propósito: las plantillas de
       AUTENTICACIÓN necesitan un componente `button` que la función
       compartida no arma, y tocarla habría cambiado un archivo del que
       dependen ~15 sitios del dental.
     · En el webhook compartido el camino barber va DESPUÉS del de clínica
       y SIEMPRE dentro de try/catch + import dinámico: ni un fallo de este
       archivo ni un fallo al CARGARLO pueden impedir que se entregue el
       mensaje de una clínica.

   ── MULTI-TENANT ───────────────────────────────────────────────────────
   Toda consulta lleva barbershopId. En el panel sale de getBarberContext();
   en el webhook se resuelve por `phone_number_id` (nunca por algo del
   cuerpo). Ojo Prisma: un barbershopId undefined BORRA el filtro.

   ── LA COLA ES BarberMessage ───────────────────────────────────────────
   No hay tabla nueva. OUTBOUND + PENDING = por enviar; el drenaje las pasa
   a SENT (con waMessageId) o FAILED (con el motivo REAL de Meta). Las filas
   que T1 marcó con BARBER_REMINDER_INVALIDATED_MARK NUNCA se envían: son
   recordatorios de una cita que se movió.
   ═══════════════════════════════════════════════════════════════════════ */

const GRAPH = "https://graph.facebook.com/v19.0";

/** Cuánto antes sale el recordatorio, como máximo. */
const REMINDER_MAX_LEAD_MS = 24 * 60 * 60 * 1000;
/**
 * …y cuánto como mínimo. Una visita agendada para dentro de media hora no
 * necesita recordatorio: el cliente acaba de agendarla.
 */
const REMINDER_MIN_LEAD_MS = 45 * 60 * 1000;

/** Tope de mensajes por pasada del drenaje (protege el tiempo de la función). */
const DRAIN_LIMIT = 60;

/** Periodo de la cuota: mensual, corrido desde messagesPeriodStart. */
const QUOTA_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Modo PLATFORM (mandar desde el número de DaleControl): PREPARADO Y
 * APAGADO. La pregunta de política con Meta —una sola WABA mandando en
 * nombre de cientos de negocios distintos— no está resuelta, y encender
 * esto sin resolverla pone en riesgo la app entera, incluida la del dental.
 * El camino de código existe (resolveSenderCredentials lo contempla) pero
 * la bandera nace apagada y hay que encenderla a conciencia.
 */
export function platformSenderEnabled(): boolean {
  return process.env.BARBER_WA_PLATFORM_SENDER === "1";
}

/* ────────────────────────── credenciales ─────────────────────────────── */

export interface BarberWaCredentials {
  barbershopId: string;
  phoneNumberId: string;
  /** Token YA descifrado. Nunca sale de este módulo ni se escribe en un log. */
  accessToken: string;
  wabaId: string | null;
  shopName: string;
  timezone: string;
  locale: string;
  address: string | null;
}

type ShopWaRow = {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  address: string | null;
  city: string | null;
  state: string | null;
  parentId: string | null;
  isActive: boolean;
  plan: string;
  subscriptionStatus: string;
  whatsappSenderMode: "PLATFORM" | "OWN_WABA";
  wabaId: string | null;
  phoneNumberId: string | null;
  whatsappToken: string | null;
  whatsappVerifiedAt: Date | null;
  messagesUsedPeriod: number;
  messagesPeriodStart: Date | null;
};

const SHOP_WA_SELECT = {
  id: true,
  name: true,
  timezone: true,
  locale: true,
  address: true,
  city: true,
  state: true,
  parentId: true,
  isActive: true,
  plan: true,
  subscriptionStatus: true,
  whatsappSenderMode: true,
  wabaId: true,
  phoneNumberId: true,
  whatsappToken: true,
  whatsappVerifiedAt: true,
  messagesUsedPeriod: true,
  messagesPeriodStart: true,
} as const;

/** Dirección de una línea para el mensaje ("Av. Juárez 120, Centro, CDMX"). */
export function formatShopAddress(shop: Pick<ShopWaRow, "address" | "city" | "state">): string {
  return [shop.address, shop.city, shop.state]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

async function loadShop(barbershopId: string): Promise<ShopWaRow | null> {
  if (!barbershopId) return null;
  return (await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: SHOP_WA_SELECT,
  })) as ShopWaRow | null;
}

/**
 * Credenciales con las que sale un mensaje de ESTA barbería.
 *
 * OWN_WABA (el modo real hoy): el número es de la barbería, el mensaje sale
 * con SU nombre y el consentimiento del cliente es con ella. PLATFORM queda
 * detrás de la bandera de arriba.
 */
export function resolveSenderCredentials(shop: ShopWaRow): BarberWaCredentials | null {
  const base = {
    barbershopId: shop.id,
    shopName: shop.name,
    timezone: shop.timezone,
    locale: shop.locale,
    address: formatShopAddress(shop) || null,
  };

  if (shop.whatsappSenderMode === "OWN_WABA" || !platformSenderEnabled()) {
    if (!shop.phoneNumberId || !shop.whatsappToken) return null;
    const token = decryptField(shop.whatsappToken) ?? shop.whatsappToken;
    if (!token) return null;
    return { ...base, phoneNumberId: shop.phoneNumberId, accessToken: token, wabaId: shop.wabaId };
  }

  // PLATFORM — apagado por bandera; el camino queda escrito y documentado.
  const phoneNumberId = process.env.BARBER_WA_PLATFORM_PHONE_NUMBER_ID;
  const rawToken = process.env.BARBER_WA_PLATFORM_TOKEN;
  if (!phoneNumberId || !rawToken) return null;
  return {
    ...base,
    phoneNumberId,
    accessToken: decryptField(rawToken) ?? rawToken,
    wabaId: process.env.BARBER_WA_PLATFORM_WABA_ID ?? null,
  };
}

/** ¿Este despliegue tiene el Embedded Signup configurado? */
export function embeddedSignupAvailable(): boolean {
  return Boolean(
    (process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID) &&
      (process.env.META_APP_SECRET ?? process.env.WHATSAPP_APP_SECRET) &&
      process.env.NEXT_PUBLIC_BARBER_WHATSAPP_ES_CONFIG_ID,
  );
}

/* ──────────────────────── estado de la conexión ──────────────────────── */

/**
 * Lo que la barbería ve en la pantalla. SIN VERIFICAR **no es un error**:
 * Meta deja escribirle a 250 clientes únicos cada 24 h sin verificación de
 * negocio, que alcanza y sobra para una barbería. Por eso el onboarding no
 * la exige: la explica.
 *
 * NO_PAYMENT_METHOD y ERROR salen de lo que Meta dijo la última vez que
 * fallamos: se leen de la última fila FAILED, no de una adivinanza.
 */
export async function getBarberWaConnection(barbershopId: string): Promise<BarberWaConnectionDTO> {
  const shop = await loadShop(barbershopId);
  const canConnect = embeddedSignupAvailable();
  if (!shop) {
    return {
      state: "DISCONNECTED",
      senderMode: "OWN_WABA",
      displayPhone: null,
      wabaId: null,
      phoneNumberId: null,
      verifiedAt: null,
      problem: null,
      canConnect,
    };
  }

  const connected = Boolean(shop.phoneNumberId && shop.whatsappToken);
  let state: BarberWaConnectionState = connected
    ? shop.whatsappVerifiedAt
      ? "CONNECTED"
      : "UNVERIFIED"
    : "DISCONNECTED";
  let problem: string | null = null;

  if (connected) {
    // Último fallo REAL de Meta (excluye los recordatorios que invalidamos
    // nosotros al mover una cita: eso no es un problema de la conexión).
    const lastFail = await prisma.barberMessage.findFirst({
      where: { barbershopId, direction: "OUTBOUND", status: "FAILED" },
      orderBy: { createdAt: "desc" },
      select: { errorMessage: true, createdAt: true },
    });
    const msg = lastFail?.errorMessage ?? null;
    if (msg && !isInvalidatedReminder(msg)) {
      if (msg.includes(`(#${WA_ERROR_CODE.BILLING_REQUIRED})`)) {
        state = "NO_PAYMENT_METHOD";
        problem = msg;
      } else if (msg.includes(`(#${WA_ERROR_CODE.TOKEN_EXPIRED})`)) {
        state = "ERROR";
        problem = msg;
      }
    }
  }

  return {
    state,
    senderMode: shop.whatsappSenderMode,
    displayPhone: null,
    wabaId: shop.wabaId,
    phoneNumberId: shop.phoneNumberId,
    verifiedAt: shop.whatsappVerifiedAt ? shop.whatsappVerifiedAt.toISOString() : null,
    problem,
    canConnect,
  };
}

/* ─────────────────────────────── cuota ───────────────────────────────── */

/**
 * Quién paga es la MATRIZ, así que el contador vive en la fila raíz: una
 * cadena de tres sedes comparte un cupo, no lo triplica (mismo criterio que
 * los límites de barberos y sedes en gating.ts).
 */
function rootIdOf(shop: Pick<ShopWaRow, "id" | "parentId">): string {
  return shop.parentId ?? shop.id;
}

/**
 * Cupo del periodo en curso. Si el periodo caducó (o nunca empezó) se
 * reinicia AQUÍ, con un updateMany acotado al valor viejo: dos peticiones
 * simultáneas no pueden reiniciarlo dos veces.
 */
export async function getBarberWaQuota(barbershopId: string): Promise<BarberWaQuotaDTO> {
  const shop = await loadShop(barbershopId);
  if (!shop) return buildBarberWaQuota({ limit: 0, used: 0, periodStart: null });

  const rootId = rootIdOf(shop);
  const root = rootId === shop.id ? shop : await loadShop(rootId);
  const effective = root ?? shop;
  const plan = await getBarberPlan(effective.plan);

  const now = new Date();
  let used = effective.messagesUsedPeriod;
  let periodStart = effective.messagesPeriodStart;

  if (!periodStart || now.getTime() - periodStart.getTime() >= QUOTA_PERIOD_MS) {
    const previous = periodStart;
    const written = await prisma.barbershop.updateMany({
      where: { id: effective.id, messagesPeriodStart: previous },
      data: { messagesPeriodStart: now, messagesUsedPeriod: 0 },
    });
    if (written.count > 0) {
      used = 0;
      periodStart = now;
    }
  }

  return buildBarberWaQuota({ limit: plan.messageQuota, used, periodStart });
}

/**
 * Suma uno al contador del periodo. Se llama SOLO cuando Meta aceptó el
 * mensaje: el cupo cuenta lo que se mandó, no lo que se intentó.
 */
async function consumeQuota(shop: ShopWaRow): Promise<void> {
  const rootId = rootIdOf(shop);
  await prisma.barbershop.update({
    where: { id: rootId },
    data: { messagesUsedPeriod: { increment: 1 } },
  }).catch((e) => {
    // El mensaje YA salió: no contarlo es mucho mejor que tumbar el envío.
    console.error(`[barber/wa] no se pudo sumar al cupo (${rootId}):`, e);
  });
}

/* ─────────────────────── POST a la Graph API ─────────────────────────── */

/**
 * Envío crudo. Copia deliberada del `postToGraph` del dental: no se
 * reutiliza aquel para no tocar src/lib/whatsapp.ts, que es de lo que vive
 * el producto que ya factura. Mismas reglas: timeout de 15 s, UN reintento
 * solo ante 5xx/429 (en timeout NO se reintenta: el mensaje pudo haber
 * salido y no-duplicar pesa más que no-perder) y WhatsAppApiError con el
 * código de Meta dentro.
 */
async function postGraph(
  creds: BarberWaCredentials,
  payload: Record<string, unknown>,
): Promise<{ wamid: string | null }> {
  const doFetch = () =>
    fetch(`${GRAPH}/${encodeURIComponent(creds.phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.accessToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

  let res = await doFetch();
  if (res.status >= 500 || res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    res = await doFetch();
  }

  const json = await res.json().catch(() => ({}) as any);
  if (!res.ok) throw parseWaError(json, res.status);
  const wamid = json?.messages?.[0]?.id;
  return { wamid: typeof wamid === "string" ? wamid : null };
}

/** Texto libre. SOLO llega dentro de la ventana de 24 h (si no, 131047). */
async function sendText(creds: BarberWaCredentials, to: string, body: string) {
  return postGraph(creds, {
    messaging_product: "whatsapp",
    to: normalizeMxWhatsAppPhone(to),
    type: "text",
    text: { body },
  });
}

/**
 * Plantilla aprobada. Las de AUTENTICACIÓN llevan ADEMÁS el componente
 * `button` con el mismo código: sin él Meta responde 132000 y el cliente se
 * queda sin poder entrar al portal.
 */
async function sendTemplate(
  creds: BarberWaCredentials,
  to: string,
  tpl: BarberWaTemplate,
  params: string[],
) {
  const components: Record<string, unknown>[] = [];
  if (params.length > 0) {
    components.push({
      type: "body",
      parameters: params.map((text) => ({ type: "text", text })),
    });
  }
  if (tpl.category === "AUTHENTICATION") {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: params[0] ?? "" }],
    });
  }

  return postGraph(creds, {
    messaging_product: "whatsapp",
    to: normalizeMxWhatsAppPhone(to),
    type: "template",
    template: {
      name: tpl.name,
      language: { code: tpl.lang },
      ...(components.length > 0 ? { components } : {}),
    },
  });
}

/* ───────────────────── alta de plantillas en la WABA ─────────────────── */

export interface BarberTemplateStatus {
  kind: BarberWaKind;
  name: string;
  category: string;
  /** APPROVED | PENDING | REJECTED | MISSING */
  status: string;
  reason: string | null;
  optional: boolean;
}

/**
 * Cuerpo con el que se da de alta cada plantilla. Las de AUTENTICACIÓN no
 * llevan texto propio: Meta lo redacta y añade el botón de copiar código.
 */
function templateCreatePayload(tpl: BarberWaTemplate): Record<string, unknown> {
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
  const varCount = countBarberWaVariables(tpl.body);
  return {
    name: tpl.name,
    language: tpl.lang,
    category: tpl.category,
    components: [
      {
        type: "BODY",
        text: tpl.body,
        ...(varCount > 0 ? { example: { body_text: [tpl.sample.slice(0, varCount)] } } : {}),
      },
    ],
  };
}

/**
 * Estado REAL de las plantillas, leído de Meta en vivo.
 *
 * Se consulta en vez de guardarse porque BarberMessage/Barbershop no tienen
 * dónde: el schema NO se toca en esta ola. Leerlo en vivo tiene además la
 * ventaja de que nunca se queda desfasado, que es justo lo que le pasa al
 * dental cuando se pierde el webhook de revisión.
 */
export async function listBarberTemplates(barbershopId: string): Promise<{
  ok: boolean;
  reason?: string;
  templates: BarberTemplateStatus[];
}> {
  const shop = await loadShop(barbershopId);
  if (!shop) return { ok: false, reason: "No se encontró la barbería.", templates: [] };
  const creds = resolveSenderCredentials(shop);
  if (!creds || !creds.wabaId) {
    return {
      ok: false,
      reason: "Conecta el WhatsApp de la barbería para poder dar de alta las plantillas.",
      templates: BARBER_WA_TEMPLATES.map((t) => ({
        kind: t.kind,
        name: t.name,
        category: t.category,
        status: "MISSING",
        reason: null,
        optional: t.optional,
      })),
    };
  }

  const byName = new Map<string, { status: string; reason: string | null }>();
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(creds.wabaId)}/message_templates?limit=200&fields=name,status,category,rejected_reason`,
      { headers: { Authorization: `Bearer ${creds.accessToken}` }, signal: AbortSignal.timeout(15000) },
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw parseWaError(json, res.status);
    for (const row of Array.isArray(json?.data) ? json.data : []) {
      if (typeof row?.name !== "string") continue;
      byName.set(row.name, {
        status: String(row.status ?? "PENDING").toUpperCase(),
        reason: typeof row.rejected_reason === "string" ? row.rejected_reason : null,
      });
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Meta no respondió.",
      templates: [],
    };
  }

  return {
    ok: true,
    templates: BARBER_WA_TEMPLATES.map((t) => {
      const found = byName.get(t.name);
      return {
        kind: t.kind,
        name: t.name,
        category: t.category,
        status: found?.status ?? "MISSING",
        reason: found?.reason ?? null,
        optional: t.optional,
      };
    }),
  };
}

/**
 * Da de alta en la WABA de la barbería las plantillas que le falten.
 *
 * IDEMPOTENTE en los dos sentidos: no vuelve a pedir las que ya existen, y
 * si Meta responde que el nombre está ocupado eso NO es un error. Nunca
 * lanza: devuelve el motivo.
 *
 * Por defecto solo las NO opcionales (todas las de utilidad + la de
 * autenticación). Las de MARKETING se activan a mano desde la pantalla,
 * porque cuestan ~4x y exigen consentimiento del cliente.
 */
export async function provisionBarberTemplates(
  barbershopId: string,
  opts: { includeMarketing?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; created: string[]; failed: { name: string; error: string }[] }> {
  const shop = await loadShop(barbershopId);
  if (!shop) return { ok: false, reason: "No se encontró la barbería.", created: [], failed: [] };
  const creds = resolveSenderCredentials(shop);
  if (!creds || !creds.wabaId) {
    return {
      ok: false,
      reason:
        "La conexión no incluye el identificador de la cuenta de WhatsApp (WABA). " +
        "Vuelve a conectar con el botón de Meta.",
      created: [],
      failed: [],
    };
  }

  const current = await listBarberTemplates(barbershopId);
  const existing = new Set(
    current.ok ? current.templates.filter((t) => t.status !== "MISSING").map((t) => t.name) : [],
  );

  const created: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const tpl of BARBER_WA_TEMPLATES) {
    if (tpl.optional && !opts.includeMarketing) continue;
    if (existing.has(tpl.name)) continue;
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
      const json: any = await res.json().catch(() => ({}));
      if (res.ok) {
        created.push(tpl.name);
        continue;
      }
      const err = parseWaError(json, res.status);
      // 2388023 / "already exists": el nombre ya está en la WABA. No es fallo.
      if (/already exists/i.test(err.message) || err.code === 2388023) {
        continue;
      }
      failed.push({ name: tpl.name, error: err.message });
    } catch (e) {
      failed.push({ name: tpl.name, error: e instanceof Error ? e.message : "Error de red" });
    }
  }

  return { ok: true, created, failed };
}

/* ──────────────────────────── la cola ────────────────────────────────── */

export interface EnqueueInput {
  barbershopId: string;
  phone: string;
  body: string;
  templateName: string | null;
  clientId?: string | null;
  appointmentId?: string | null;
}

/** Mete una fila OUTBOUND / PENDING. El drenaje la manda. */
export async function enqueueBarberMessage(input: EnqueueInput): Promise<string | null> {
  const phone = mxTenDigits(input.phone);
  if (!phone) return null;
  const row = await prisma.barberMessage.create({
    data: {
      barbershopId: input.barbershopId,
      direction: "OUTBOUND",
      phone,
      body: input.body,
      templateName: input.templateName,
      status: "PENDING",
      clientId: input.clientId ?? null,
      appointmentId: input.appointmentId ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

/** ¿Escribió el cliente en las últimas 24 h? (ventana de servicio abierta) */
async function lastInboundAt(barbershopId: string, phone: string): Promise<Date | null> {
  const row = await prisma.barberMessage.findFirst({
    where: { barbershopId, phone, direction: "INBOUND" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

/**
 * Decide con qué manda una fila de la cola y la manda.
 *
 * REGLA DE COSTO: si la ventana de 24 h está abierta va como TEXTO — Meta no
 * cobra las plantillas de utilidad entregadas dentro de una ventana de
 * servicio abierta, y el texto además se lee mejor. Fuera de la ventana, la
 * plantilla es la ÚNICA vía.
 */
async function deliverRow(
  shop: ShopWaRow,
  creds: BarberWaCredentials,
  row: {
    id: string;
    phone: string;
    body: string | null;
    templateName: string | null;
    appointmentId: string | null;
  },
): Promise<void> {
  const windowOpen = barberWaWindowOpen(await lastInboundAt(shop.id, row.phone));

  let result: { wamid: string | null };
  if (windowOpen && row.body) {
    result = await sendText(creds, row.phone, row.body);
  } else {
    const plan = await resolveTemplateForRow(shop, creds, row);
    if (!plan) {
      throw new WhatsAppApiError({
        message:
          "Fuera de la ventana de 24 h y sin plantilla utilizable para este aviso. " +
          "Da de alta las plantillas en la pantalla de WhatsApp.",
        httpStatus: 0,
      });
    }
    result = await sendTemplate(creds, row.phone, plan.tpl, plan.params);
  }

  await prisma.barberMessage.update({
    where: { id: row.id },
    data: { status: "SENT", waMessageId: result.wamid, errorMessage: null },
  });
  await consumeQuota(shop);
}

/**
 * De la fila de la cola a (plantilla, parámetros).
 *
 * Los parámetros del recordatorio y de la confirmación se RECALCULAN aquí
 * leyendo la cita: así el mensaje sale siempre con la hora que la cita tiene
 * AHORA, no con la que tenía cuando se encoló. (En el dental ese desfase es
 * el bug M-22: al reagendar, al paciente le llegaba el aviso de la hora
 * vieja. T1 además invalida la fila anterior — ver scheduleBarberReminders.)
 */
async function resolveTemplateForRow(
  shop: ShopWaRow,
  _creds: BarberWaCredentials,
  row: { phone: string; body: string | null; templateName: string | null; appointmentId: string | null },
): Promise<{ tpl: BarberWaTemplate; params: string[] } | null> {
  // La fila que encola T1 desde la fila virtual trae SU propio discriminador.
  if (row.templateName === BARBER_WALKIN_NOTIFY_TEMPLATE) {
    return {
      tpl: barberWaTemplate("walkinTurn"),
      params: [shop.name, (row.body ?? "").trim() || "Ya casi es tu turno."],
    };
  }

  const reminder = barberWaTemplate("reminder");
  const booking = barberWaTemplate("bookingConfirmed");

  if (row.templateName === reminder.name && row.appointmentId) {
    const params = await reminderParams(shop, row.appointmentId);
    return params ? { tpl: reminder, params } : null;
  }
  if (row.templateName === booking.name && row.appointmentId) {
    const params = await bookingParams(shop, row.appointmentId);
    return params ? { tpl: booking, params } : null;
  }
  return null;
}

/**
 * Drena la cola de UNA barbería. Devuelve cuántas salieron y cuántas
 * fallaron. Nunca lanza: un mensaje que revienta no puede llevarse por
 * delante los demás.
 */
export async function drainBarberOutbox(barbershopId: string): Promise<{ sent: number; failed: number; skipped: number }> {
  const shop = await loadShop(barbershopId);
  if (!shop || !shop.isActive) return { sent: 0, failed: 0, skipped: 0 };

  const creds = resolveSenderCredentials(shop);
  if (!creds) return { sent: 0, failed: 0, skipped: 0 };

  const rows = await prisma.barberMessage.findMany({
    where: { barbershopId, direction: "OUTBOUND", status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: DRAIN_LIMIT,
    select: { id: true, phone: true, body: true, templateName: true, appointmentId: true, errorMessage: true },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Recordatorio que T1 invalidó al mover/cancelar la cita: NUNCA sale.
    // (No debería estar PENDING —T1 lo pasa a FAILED— pero el contrato dice
    // "no tomes nada con esta marca" y aquí se cumple al pie de la letra.)
    if (isInvalidatedReminder(row.errorMessage)) {
      skipped++;
      continue;
    }

    const quota = await getBarberWaQuota(barbershopId);
    if (!barberWaFits(quota.limit, quota.used)) {
      // Cupo agotado: NO se falla la fila ni se borra. Se queda esperando al
      // siguiente periodo y la pantalla ya venía avisando desde el 80 %.
      skipped += rows.length - i;
      break;
    }

    try {
      await deliverRow(shop, creds, row);
      sent++;
    } catch (err) {
      failed++;
      const message =
        err instanceof WhatsAppApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "No se pudo enviar";
      await prisma.barberMessage
        .update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
    }
  }

  return { sent, failed, skipped };
}

/* ──────────────────────── recordatorios de cita ──────────────────────── */

function formatWhen(date: Date, timezone: string, locale: string): string {
  const loc = locale === "en" ? "en-US" : "es-MX";
  try {
    const day = new Intl.DateTimeFormat(loc, {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(date);
    const time = new Intl.DateTimeFormat(loc, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
    return `${day} a las ${time}`;
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

function firstName(name: string | null | undefined): string {
  const clean = String(name ?? "").trim();
  if (!clean) return "Hola";
  return clean.split(/\s+/)[0];
}

type ApptForMessage = {
  id: string;
  startAt: Date;
  clientName: string | null;
  client: { name: string } | null;
  barber: { name: string; nickname: string | null } | null;
  services: { service: { name: string } }[];
};

const APPT_MESSAGE_INCLUDE = {
  client: { select: { name: true } },
  barber: { select: { name: true, nickname: true } },
  services: { select: { service: { select: { name: true } } } },
} as const;

/** {{1}} cliente · {{2}} barbería · {{3}} fecha · {{4}} servicio · {{5}} barbero · {{6}} dirección */
function reminderParamsFrom(shop: ShopWaRow, appt: ApptForMessage): string[] {
  const services = appt.services.map((s) => s.service.name).filter(Boolean);
  return [
    firstName(appt.client?.name ?? appt.clientName),
    shop.name,
    formatWhen(appt.startAt, shop.timezone, shop.locale),
    services.length > 0 ? services.join(" + ") : "Tu servicio",
    appt.barber ? appt.barber.nickname?.trim() || appt.barber.name : "el barbero disponible",
    formatShopAddress(shop) || shop.name,
  ];
}

/** {{1}} cliente · {{2}} barbería · {{3}} fecha · {{4}} dirección */
function bookingParamsFrom(shop: ShopWaRow, appt: ApptForMessage): string[] {
  return [
    firstName(appt.client?.name ?? appt.clientName),
    shop.name,
    formatWhen(appt.startAt, shop.timezone, shop.locale),
    formatShopAddress(shop) || shop.name,
  ];
}

async function loadAppt(shopId: string, appointmentId: string): Promise<ApptForMessage | null> {
  return (await prisma.barberAppointment.findFirst({
    where: { id: appointmentId, barbershopId: shopId },
    select: { id: true, startAt: true, clientName: true, ...APPT_MESSAGE_INCLUDE },
  })) as ApptForMessage | null;
}

async function reminderParams(shop: ShopWaRow, appointmentId: string): Promise<string[] | null> {
  const appt = await loadAppt(shop.id, appointmentId);
  return appt ? reminderParamsFrom(shop, appt) : null;
}

async function bookingParams(shop: ShopWaRow, appointmentId: string): Promise<string[] | null> {
  const appt = await loadAppt(shop.id, appointmentId);
  return appt ? bookingParamsFrom(shop, appt) : null;
}

/** Texto del recordatorio para la ventana abierta (y para la vista previa). */
export function renderReminderText(params: string[]): string {
  const [cliente, shopName, cuando, servicio, barbero, direccion] = params;
  return (
    `Hola ${cliente}, te recordamos tu visita en ${shopName}.\n\n` +
    `🗓️ ${cuando}\n✂️ ${servicio}\n💈 Con ${barbero}\n📍 ${direccion}\n\n` +
    `Responde *CONFIRMAR* para confirmar, *CANCELAR* si no podrás venir ` +
    `o *CAMBIAR* si quieres otro horario.`
  );
}

export function renderBookingText(params: string[]): string {
  const [cliente, shopName, cuando, direccion] = params;
  return (
    `¡Listo ${cliente}! Tu visita en ${shopName} quedó agendada.\n\n` +
    `🗓️ ${cuando}\n📍 ${direccion}\n\n` +
    `Si necesitas moverla, respóndenos por aquí.`
  );
}

/**
 * Programa los recordatorios que faltan de UNA barbería.
 *
 * 🔴 EL BUG M-22 NO SE REPITE AQUÍ. Cuando T1 mueve o cancela una cita,
 * marca sus recordatorios PENDING como FAILED con
 * BARBER_REMINDER_INVALIDATED_MARK. Esta función considera "ya atendida"
 * una cita que tenga CUALQUIER fila de recordatorio que NO sea una fila
 * invalidada por nosotros. O sea:
 *   · fila SENT/DELIVERED/READ/PENDING → no se vuelve a programar;
 *   · fila FAILED por un error REAL de Meta (número inexistente) → tampoco:
 *     reintentarla cada 15 min sería spam de fallos;
 *   · fila FAILED **con la marca de invalidación** → SÍ se programa de
 *     nuevo, y como los parámetros se recalculan al enviar, el mensaje sale
 *     con la hora NUEVA.
 */
export async function scheduleBarberReminders(barbershopId: string): Promise<{ queued: number }> {
  const shop = await loadShop(barbershopId);
  if (!shop || !shop.isActive) return { queued: 0 };

  // El plan y la suscripción se resuelven sobre la fila que PAGA (la matriz),
  // igual que en gating.ts: una sucursal hereda los dos de su matriz.
  const rootId = rootIdOf(shop);
  const root = rootId === shop.id ? shop : ((await loadShop(rootId)) ?? shop);
  if (!isBarbershopSubscriptionActive(root)) return { queued: 0 };

  const plan = await getBarberPlan(root.plan);
  if (!barberPlanHasFeature(plan, "whatsappReminders")) return { queued: 0 };
  if (!resolveSenderCredentials(shop)) return { queued: 0 };

  const now = Date.now();
  const from = new Date(now + REMINDER_MIN_LEAD_MS);
  const to = new Date(now + REMINDER_MAX_LEAD_MS);

  const appointments = await prisma.barberAppointment.findMany({
    where: {
      barbershopId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startAt: { gte: from, lte: to },
    },
    select: { id: true, clientId: true, clientPhone: true, client: { select: { phone: true } } },
    take: 200,
  });
  if (appointments.length === 0) return { queued: 0 };

  const template = barberWaTemplate("reminder");
  const existing = await prisma.barberMessage.findMany({
    where: {
      barbershopId,
      templateName: template.name,
      appointmentId: { in: appointments.map((a) => a.id) },
    },
    select: { appointmentId: true, status: true, errorMessage: true },
  });

  // La decisión es PURA y está probada sin BD (whatsapp-core.ts):
  // reminderAlreadyHandled. Aquí solo se agrupa por cita.
  const byAppointment = new Map<string, { status: (typeof existing)[number]["status"]; errorMessage: string | null }[]>();
  for (const row of existing) {
    if (!row.appointmentId) continue;
    const list = byAppointment.get(row.appointmentId) ?? [];
    list.push({ status: row.status, errorMessage: row.errorMessage });
    byAppointment.set(row.appointmentId, list);
  }
  const handled = new Set<string>();
  for (const [appointmentId, rows] of Array.from(byAppointment.entries())) {
    if (reminderAlreadyHandled(rows, isInvalidatedReminder)) handled.add(appointmentId);
  }

  let queued = 0;
  for (const appt of appointments) {
    if (handled.has(appt.id)) continue;
    const phone = mxTenDigits(appt.client?.phone ?? appt.clientPhone ?? "");
    if (!phone) continue;

    const params = await reminderParams(shop, appt.id);
    if (!params) continue;

    await enqueueBarberMessage({
      barbershopId,
      phone,
      body: renderReminderText(params),
      templateName: template.name,
      clientId: appt.clientId,
      appointmentId: appt.id,
    });
    queued++;
  }

  return { queued };
}

/**
 * Una pasada completa para TODAS las barberías conectadas: programa lo que
 * falte y drena la cola. Es lo que llama el cron (y el botón "enviar
 * pendientes" de la pantalla, acotado a una sola barbería).
 */
export async function runBarberWaDispatch(only?: string): Promise<{
  shops: number;
  queued: number;
  sent: number;
  failed: number;
}> {
  const shops = await prisma.barbershop.findMany({
    where: {
      isActive: true,
      phoneNumberId: { not: null },
      whatsappToken: { not: null },
      ...(only ? { id: only } : {}),
    },
    select: { id: true },
    take: 500,
  });

  let queued = 0;
  let sent = 0;
  let failed = 0;
  for (const shop of shops) {
    try {
      queued += (await scheduleBarberReminders(shop.id)).queued;
      const drained = await drainBarberOutbox(shop.id);
      sent += drained.sent;
      failed += drained.failed;
    } catch (e) {
      // Una barbería con un problema no puede dejar sin mensajes a las demás.
      console.error(`[barber/wa] barbería ${shop.id} no despachada:`, e);
    }
  }
  return { shops: shops.length, queued, sent, failed };
}

/* ─────────────────── envíos que otras terminales piden ───────────────── */

/**
 * Código de acceso al portal del cliente (gancho de T5).
 *
 * Categoría AUTHENTICATION: es lo que Meta exige para un código de un solo
 * uso, y trae botón de "copiar" en el teléfono del cliente.
 *
 * Se manda EN EL MOMENTO (no por la cola): un código que llega dentro de un
 * minuto ya no sirve para entrar. El código NUNCA se guarda: la fila del
 * Inbox deja constancia del envío con un cuerpo neutro.
 */
export async function sendBarberPortalCode(args: {
  barbershopId: string;
  phone: string;
  code: string;
}): Promise<boolean> {
  const phone = mxTenDigits(args.phone);
  if (!phone) return false;
  const shop = await loadShop(args.barbershopId);
  if (!shop) return false;
  const creds = resolveSenderCredentials(shop);
  if (!creds) return false;

  const quota = await getBarberWaQuota(shop.id);
  if (!barberWaFits(quota.limit, quota.used)) return false;

  const tpl = barberWaTemplate("portalCode");
  const row = await prisma.barberMessage.create({
    data: {
      barbershopId: shop.id,
      direction: "OUTBOUND",
      phone,
      // El código NO se guarda ni aquí ni en un log: la fila solo deja rastro.
      body: "Código de acceso al portal (no se guarda por seguridad).",
      templateName: tpl.name,
      status: "PENDING",
    },
    select: { id: true },
  });

  try {
    const { wamid } = await sendTemplate(creds, phone, tpl, [args.code]);
    await prisma.barberMessage.update({
      where: { id: row.id },
      data: { status: "SENT", waMessageId: wamid },
    });
    await consumeQuota(shop);
    return true;
  } catch (err) {
    await prisma.barberMessage
      .update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : "No se pudo enviar el código",
        },
      })
      .catch(() => {});
    return false;
  }
}

/**
 * Confirmación de reserva (gancho de T5). Va por la cola: el cliente acaba
 * de ver la pantalla de "listo", así que un minuto de diferencia no rompe
 * nada y a cambio el flujo de reserva nunca se queda esperando a Meta.
 */
export async function queueBarberBookingConfirmation(args: {
  barbershopId: string;
  appointmentId: string;
}): Promise<void> {
  const shop = await loadShop(args.barbershopId);
  if (!shop || !resolveSenderCredentials(shop)) return;

  const appt = await prisma.barberAppointment.findFirst({
    where: { id: args.appointmentId, barbershopId: shop.id },
    select: {
      id: true,
      startAt: true,
      clientId: true,
      clientName: true,
      clientPhone: true,
      ...APPT_MESSAGE_INCLUDE,
    },
  });
  if (!appt) return;

  const phone = mxTenDigits(appt.clientPhone ?? "");
  if (!phone) return;

  const tpl = barberWaTemplate("bookingConfirmed");
  // Idempotencia: una reserva no confirma dos veces aunque el flujo reintente.
  const already = await prisma.barberMessage.findFirst({
    where: { barbershopId: shop.id, appointmentId: appt.id, templateName: tpl.name },
    select: { id: true },
  });
  if (already) return;

  const params = bookingParamsFrom(shop, appt as unknown as ApptForMessage);
  await enqueueBarberMessage({
    barbershopId: shop.id,
    phone,
    body: renderBookingText(params),
    templateName: tpl.name,
    clientId: appt.clientId,
    appointmentId: appt.id,
  });
}

/* ─────────────────────── campañas (marketing) ────────────────────────── */

/** Tope por llamada: la pantalla manda por tandas y ve el resultado real. */
export const CAMPAIGN_BATCH_MAX = 60;

/**
 * Manda una campaña de MARKETING. NUNCA se dispara sola: exige acción
 * explícita de la barbería, que antes ve a cuánta gente le va a escribir y
 * cuánto le va a costar. `marketing` cuesta ~4x que `utility` y el cliente
 * puede bloquear ese tipo de mensajes: por eso no es automática.
 *
 * Va EN EL MOMENTO y no por la cola a propósito: la promoción la escribe la
 * barbería en el formulario y no hay dónde guardarla para reconstruir los
 * parámetros al enviar (BarberMessage no tiene columna de parámetros y el
 * schema no se toca). Enviando aquí, quien aprieta el botón ve exactamente
 * cuántos salieron y cuántos no — que es lo mínimo cuando se gasta dinero.
 */
export async function sendBarberCampaign(args: {
  barbershopId: string;
  kind: "birthday" | "winback";
  promo: string;
  clientIds: string[];
}): Promise<{ sent: number; failed: number; skipped: number }> {
  const ids = args.clientIds.slice(0, CAMPAIGN_BATCH_MAX);
  const shop = await loadShop(args.barbershopId);
  const creds = shop ? resolveSenderCredentials(shop) : null;
  if (!shop || !creds) return { sent: 0, failed: 0, skipped: ids.length };

  const tpl = barberWaTemplate(args.kind);
  const clients = await prisma.barberClient.findMany({
    where: { barbershopId: shop.id, id: { in: ids }, blockedAt: null },
    select: { id: true, name: true, phone: true },
  });

  const promo = args.promo.trim().slice(0, 300) || "Te esperamos cuando gustes.";
  let sent = 0;
  let failed = 0;

  for (const client of clients) {
    const phone = mxTenDigits(client.phone);
    if (!phone) continue;

    const quota = await getBarberWaQuota(shop.id);
    if (!barberWaFits(quota.limit, quota.used)) break;

    const params = [firstName(client.name), shop.name, promo];
    const row = await prisma.barberMessage.create({
      data: {
        barbershopId: shop.id,
        direction: "OUTBOUND",
        phone,
        body: renderCampaignText(args.kind, params),
        templateName: tpl.name,
        status: "PENDING",
        clientId: client.id,
      },
      select: { id: true },
    });

    try {
      const { wamid } = await sendTemplate(creds, phone, tpl, params);
      await prisma.barberMessage.update({
        where: { id: row.id },
        data: { status: "SENT", waMessageId: wamid },
      });
      await consumeQuota(shop);
      sent++;
    } catch (err) {
      failed++;
      await prisma.barberMessage
        .update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : "No se pudo enviar",
          },
        })
        .catch(() => {});
    }
  }

  return { sent, failed, skipped: ids.length - sent - failed };
}

/**
 * Mismo texto que la plantilla aprobada, con las variables ya sustituidas.
 * Es lo que se guarda en el Inbox (para que la barbería lea lo que mandó) y
 * lo que saldría por texto libre si la ventana estuviera abierta. Si cambia
 * el cuerpo del catálogo, cambia aquí: la prueba del catálogo vigila el de
 * allá y este debe leerse igual.
 */
export function renderCampaignText(kind: "birthday" | "winback", params: string[]): string {
  const [cliente, shopName, promo] = params;
  if (kind === "birthday") {
    return `¡Feliz cumpleaños, ${cliente}! 🎉 En ${shopName} queremos dejarte impecable: ${promo} Pásate cuando gustes.`;
  }
  return `Hola ${cliente}, hace rato que no te vemos en ${shopName}. ${promo} Aquí te esperamos.`;
}

/* ═══════════════════════ ENTRADA: el webhook ══════════════════════════ */

/**
 * Resuelve la barbería por el phone_number_id de Meta. El tenant NUNCA sale
 * del cuerpo del webhook: solo de esta columna.
 */
async function shopByPhoneNumberId(phoneNumberId: unknown): Promise<ShopWaRow | null> {
  if (typeof phoneNumberId !== "string" || !phoneNumberId) return null;
  return (await prisma.barbershop.findFirst({
    where: { phoneNumberId },
    select: SHOP_WA_SELECT,
  })) as ShopWaRow | null;
}

/**
 * Describe en una frase un mensaje entrante que NO es texto y extrae su
 * adjunto (por media id: aquí NO se descarga ni se guarda nada).
 *
 * Igual que en el dental, un tipo desconocido NO devuelve null sino una
 * frase honesta: nada de lo que manda un cliente puede desaparecer en
 * silencio. Devuelve null solo para `text`.
 */
export function describeBarberIncoming(
  msg: any,
): { body: string; attachment: BarberWaAttachment | null } | null {
  if (!msg || msg.type === "text") return null;

  const media = (kind: BarberWaAttachmentKind, obj: any): BarberWaAttachment | null => {
    if (typeof obj?.id !== "string" || obj.id.length === 0) return null;
    const att: BarberWaAttachment = { kind, mediaId: obj.id };
    if (typeof obj.mime_type === "string" && obj.mime_type) att.mime = obj.mime_type;
    if (typeof obj.filename === "string" && obj.filename.trim()) att.filename = obj.filename.trim();
    return att;
  };
  const withCaption = (body: string, obj: any): string => {
    const caption = typeof obj?.caption === "string" ? obj.caption.trim() : "";
    return caption ? `${body} — ${caption}` : body;
  };

  switch (msg.type) {
    case "image":
      return { body: withCaption("📷 Te mandaron una foto", msg.image), attachment: media("image", msg.image) };
    case "video":
      return { body: withCaption("🎥 Te mandaron un video", msg.video), attachment: media("video", msg.video) };
    case "audio":
      return {
        body: msg.audio?.voice === true ? "🎤 Te mandaron una nota de voz" : "🎵 Te mandaron un audio",
        attachment: media("audio", msg.audio),
      };
    case "document": {
      const filename = typeof msg.document?.filename === "string" ? msg.document.filename.trim() : "";
      return {
        body: withCaption(`📄 Te mandaron el archivo ${filename || "sin nombre"}`, msg.document),
        attachment: media("document", msg.document),
      };
    }
    case "sticker":
      return { body: "Te mandaron una calcomanía", attachment: media("sticker", msg.sticker) };
    case "location": {
      const lat = Number(msg.location?.latitude);
      const lng = Number(msg.location?.longitude);
      let body = "📍 Te mandaron su ubicación";
      if (Number.isFinite(lat) && Number.isFinite(lng)) body += `: https://maps.google.com/?q=${lat},${lng}`;
      return { body, attachment: null };
    }
    case "contacts": {
      const contacts: any[] = Array.isArray(msg.contacts) ? msg.contacts : [];
      const names = contacts
        .map((c) => {
          const name = typeof c?.name?.formatted_name === "string" ? c.name.formatted_name.trim() : "";
          const phone = typeof c?.phones?.[0]?.phone === "string" ? c.phones[0].phone.trim() : "";
          return phone ? `${name || "sin nombre"} (${phone})` : name;
        })
        .filter((s) => s.length > 0);
      return {
        body: `👤 Te compartieron el contacto de ${names.length > 0 ? names.join(", ") : "alguien"}`,
        attachment: null,
      };
    }
    case "reaction": {
      const emoji = typeof msg.reaction?.emoji === "string" ? msg.reaction.emoji.trim() : "";
      return {
        body: emoji ? `Reaccionó ${emoji} a un mensaje` : "Quitó su reacción a un mensaje",
        attachment: null,
      };
    }
    default:
      return {
        body: "Te mandaron un mensaje que el panel todavía no sabe mostrar. Ábrelo en el WhatsApp de la barbería.",
        attachment: null,
      };
  }
}

const AMBIGUOUS_REPLY =
  "📋 Con este número tenemos más de una visita por confirmar y no sabemos cuál es la tuya. " +
  "Para no moverle la cita a otra persona, el equipo de la barbería te escribe en un momento. 🙏";

/**
 * INGESTA DE UN MENSAJE ENTRANTE de una barbería.
 *
 * La llama el webhook compartido SOLO cuando el phone_number_id no es de
 * ninguna clínica, dentro de try/catch y con import dinámico: nada de lo que
 * pase aquí puede afectar al camino dental.
 *
 * Devuelve true si el mensaje era de una barbería (para el log del webhook).
 */
export async function ingestBarberInbound(value: any, msg: any): Promise<boolean> {
  const shop = await shopByPhoneNumberId(value?.metadata?.phone_number_id);
  if (!shop) return false;

  const from = typeof msg?.from === "string" ? msg.from : "";
  const phone = mxTenDigits(from);
  if (!phone) return true;

  // Dedup por wamid: Meta reintenta el webhook ante timeouts y 5xx.
  const wamid = typeof msg?.id === "string" ? msg.id : null;
  if (wamid) {
    const duplicate = await prisma.barberMessage.findFirst({
      where: { barbershopId: shop.id, waMessageId: wamid, direction: "INBOUND" },
      select: { id: true },
    });
    if (duplicate) return true;
  }

  const rawText = String(
    msg?.text?.body ??
      msg?.interactive?.button_reply?.title ??
      msg?.interactive?.list_reply?.title ??
      msg?.button?.text ??
      "",
  ).trim();
  const incoming = rawText ? null : describeBarberIncoming(msg);
  if (!rawText && !incoming) return true;

  // Se LIGA a un cliente existente; jamás se crea uno desde el webhook (un
  // número equivocado no puede dar de alta clientes fantasma).
  const client = await prisma.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId: shop.id, phone } },
    select: { id: true },
  });

  try {
    await prisma.barberMessage.create({
      data: {
        barbershopId: shop.id,
        direction: "INBOUND",
        phone,
        body: rawText || incoming!.body,
        waMessageId: wamid,
        status: "DELIVERED",
        clientId: client?.id ?? null,
        // El adjunto viaja en templateName con prefijo `attach:` porque
        // BarberMessage no tiene columna para adjuntos y el schema no se
        // toca. Ver whatsapp-core.ts.
        templateName: incoming?.attachment ? encodeBarberWaAttachment(incoming.attachment) : null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return true;
    throw err;
  }

  // Palomitas azules en el teléfono del cliente. Best-effort: una palomita
  // nunca puede tumbar la ingesta.
  const creds = resolveSenderCredentials(shop);
  if (creds && wamid) {
    void markWhatsAppMessageRead(creds.phoneNumberId, creds.accessToken, wamid).catch(() => {});
  }

  // Multimedia: llegó, quedó en el Inbox y AQUÍ TERMINA. Una foto no es un
  // "CONFIRMAR" y no puede tocar la agenda de nadie.
  if (incoming) return true;

  const handled = await applyReminderReply(shop, creds, phone, rawText);

  // El BOT es el último en la fila, a propósito: primero manda lo que el
  // cliente respondió a un recordatorio nuestro (eso ya tiene dueño y no
  // se le consulta a ninguna IA). Solo lo que nadie atendió llega al bot.
  if (!handled) await runBotIfEnabled(shop, creds, phone, rawText);
  return true;
}

/**
 * Puente al bot que agenda (src/lib/barber/bot.ts).
 *
 * ESTE módulo NO sabe nada del bot: import DINÁMICO dentro de try/catch,
 * igual que el webhook compartido hace con el vertical entero. Ni un fallo
 * del bot ni un fallo al CARGAR su módulo pueden romper la ingesta, los
 * recordatorios ni el Inbox — que es de lo que ya vive el producto.
 *
 * El bot decide QUÉ decir; el envío sigue siendo de aquí (replyInline:
 * ventana de 24 h, cupo y registro en el Inbox incluidos). Así el bot no
 * puede inventarse un camino de envío ni saltarse el cupo.
 */
async function runBotIfEnabled(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  text: string,
): Promise<void> {
  try {
    const { runBarberBotTurn } = await import("@/lib/barber/bot");
    const turn = await runBarberBotTurn({
      barbershopId: shop.id,
      phone,
      text,
    });
    if (turn.reply) await replyInline(shop, creds, phone, turn.reply);
  } catch (err) {
    console.error(`[barber/wa] el bot no pudo atender (${shop.id}):`, err);
  }
}

/**
 * Aplica la respuesta del cliente sobre la visita que le recordamos.
 *
 * La transición SIEMPRE pasa por canTransition() del contrato: si el estado
 * no lo permite (la visita ya se completó, ya estaba cancelada) no se toca
 * nada y se le contesta la verdad.
 *
 * Devuelve true si ESTE camino ya atendió el mensaje (movió la visita y/o
 * le contestó). false = el mensaje sigue sin dueño, y entonces lo toma el
 * bot. Sin esta señal, un "CONFIRMAR" recibiría dos respuestas.
 */
async function applyReminderReply(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  text: string,
): Promise<boolean> {
  const action = classifyBarberReply(text);
  if (action === "unclear") return false;

  const template = barberWaTemplate("reminder");
  const sentReminders = await prisma.barberMessage.findMany({
    where: {
      barbershopId: shop.id,
      phone,
      direction: "OUTBOUND",
      templateName: template.name,
      status: { in: ["SENT", "DELIVERED", "READ"] },
      appointmentId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      appointmentId: true,
      appointment: { select: { id: true, status: true, startAt: true, clientId: true } },
    },
  });

  // Visitas VIVAS y futuras a las que esta respuesta podría aplicar.
  const seen = new Set<string>();
  const candidates = sentReminders
    .map((r) => r.appointment)
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .filter((a) => a.startAt.getTime() > Date.now() - 60 * 60 * 1000)
    .filter((a) => a.status === "PENDING" || a.status === "CONFIRMED")
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));

  // Sin ninguna visita a la que aplicar, esto no es una respuesta a un
  // recordatorio aunque lo parezca: que lo lea el bot.
  if (candidates.length === 0) return false;

  // Un teléfono compartido (el celular de la familia) con DOS visitas por
  // confirmar: no se adivina. Se le dice y lo resuelve el mostrador.
  if (candidates.length > 1) {
    await replyInline(shop, creds, phone, AMBIGUOUS_REPLY);
    return true;
  }

  const appt = candidates[0];
  const current = appt.status as BarberAppointmentStatus;

  if (action === "confirm") {
    if (canTransition(current, "CONFIRMED")) {
      await prisma.barberAppointment.update({
        where: { id: appt.id },
        data: { status: "CONFIRMED" },
      });
      await replyInline(
        shop,
        creds,
        phone,
        `✅ ¡Listo! Tu visita del ${formatWhen(appt.startAt, shop.timezone, shop.locale)} está confirmada. Te esperamos.`,
      );
    } else {
      await replyInline(
        shop,
        creds,
        phone,
        `✅ Tu visita del ${formatWhen(appt.startAt, shop.timezone, shop.locale)} ya estaba confirmada. Te esperamos.`,
      );
    }
    return true;
  }

  if (action === "cancel") {
    // No se puede cancelar (ya se completó, ya estaba cancelada): aquí no hay
    // nada que hacer, pero el cliente merece una respuesta. Se la da el bot,
    // que sí sabe explicarlo y ofrecer alternativas.
    if (!canTransition(current, "CANCELLED")) return false;
    await prisma.$transaction(async (tx) => {
      await tx.barberAppointment.update({
        where: { id: appt.id },
        data: { status: "CANCELLED" },
      });
      // Los recordatorios que quedaran en cola para esa visita ya no tienen
      // sentido: se invalidan con los helpers de T1 (misma marca, mismo
      // criterio), no con una marca inventada aquí.
      await tx.barberMessage.updateMany({
        where: pendingReminderInvalidationWhere(shop.id, appt.id),
        data: reminderInvalidationData("CANCELLED"),
      });
    });
    await replyInline(
      shop,
      creds,
      phone,
      "❌ Tu visita quedó cancelada. Cuando quieras agendar de nuevo, escríbenos por aquí. ¡Nos vemos!",
    );
    return true;
  }

  // reschedule — NO se toca el estado de la visita: cambiar de horario es
  // elegir uno nuevo, y eso lo hace el cliente o el mostrador. El hilo queda
  // en el Inbox para que alguien lo atienda.
  await replyInline(
    shop,
    creds,
    phone,
    "🗓️ Con gusto te movemos la visita. Dinos qué día y a qué hora te queda mejor y te confirmamos el lugar.",
  );
  return true;
}

/**
 * Contesta al cliente EN EL MOMENTO. Solo se usa dentro de la ventana de
 * 24 h (acaba de escribirnos), así que va como texto: gratis y natural.
 * Best-effort — una respuesta que no sale no puede tumbar la ingesta.
 */
async function replyInline(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  body: string,
): Promise<void> {
  if (!creds) return;
  const row = await prisma.barberMessage
    .create({
      data: {
        barbershopId: shop.id,
        direction: "OUTBOUND",
        phone,
        body,
        status: "PENDING",
      },
      select: { id: true },
    })
    .catch(() => null);

  try {
    const { wamid } = await sendText(creds, phone, body);
    if (row) {
      await prisma.barberMessage.update({
        where: { id: row.id },
        data: { status: "SENT", waMessageId: wamid },
      });
    }
    await consumeQuota(shop);
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo responder";
    if (row) {
      await prisma.barberMessage
        .update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
    }
  }
}

/* ───────────────── estados de entrega REALES (webhook) ───────────────── */

/**
 * Estados de entrega de lo que mandó una barbería.
 *
 * 🔴 EN EL DENTAL UN RECORDATORIO RECHAZADO SE VEÍA COMO ENTREGADO. Aquí el
 * estado que se guarda es el que dijo Meta, y `failed` escribe el motivo con
 * su código para que la pantalla lo enseñe tal cual.
 *
 * La decisión de QUÉ escribir es pura y está probada sin BD
 * (nextBarberWaStatus, whatsapp-core.ts): idempotente, monótona y con FAILED
 * ganando siempre. Aquí solo se resuelve el inquilino y se escribe.
 */
export async function applyBarberDeliveryStatuses(
  phoneNumberId: unknown,
  statuses: any[],
): Promise<boolean> {
  const shop = await shopByPhoneNumberId(phoneNumberId);
  if (!shop) return false;

  for (const st of Array.isArray(statuses) ? statuses : []) {
    const wamid = typeof st?.id === "string" ? st.id : null;
    const raw = typeof st?.status === "string" ? st.status.toUpperCase() : null;
    if (!wamid || !raw) continue;

    try {
      const row = await prisma.barberMessage.findFirst({
        where: { barbershopId: shop.id, waMessageId: wamid, direction: "OUTBOUND" },
        select: { id: true, status: true },
      });
      if (!row) continue;

      const next = nextBarberWaStatus(row.status, raw);
      // null = repetido, desconocido, o que haría retroceder el estado.
      if (!next) continue;

      if (next === "FAILED") {
        const err = Array.isArray(st?.errors) ? st.errors[0] : null;
        const code = typeof err?.code === "number" ? err.code : null;
        const title =
          (typeof err?.title === "string" && err.title) ||
          (typeof err?.message === "string" && err.message) ||
          "Meta no pudo entregar el mensaje";
        await prisma.barberMessage.update({
          where: { id: row.id },
          // El código va DENTRO del texto: es lo que lee la pantalla para
          // explicarle a la barbería por qué no se entregó.
          data: { status: "FAILED", errorMessage: code == null ? title : `(#${code}) ${title}` },
        });
        continue;
      }

      await prisma.barberMessage.update({ where: { id: row.id }, data: { status: next } });
    } catch (e) {
      console.error("[barber/wa] estado no aplicado:", e);
    }
  }
  return true;
}

/* ────────────────────────────── el Inbox ─────────────────────────────── */

/** Fila cruda que leen las dos vistas del Inbox. */
const MESSAGE_SELECT = {
  id: true,
  direction: true,
  status: true,
  body: true,
  errorMessage: true,
  templateName: true,
  createdAt: true,
  appointmentId: true,
  clientId: true,
  phone: true,
} as const;

function toMessageDTO(row: {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  body: string | null;
  errorMessage: string | null;
  templateName: string | null;
  createdAt: Date;
  appointmentId: string | null;
}): BarberWaMessageDTO {
  const attachment = parseBarberWaAttachment(row.templateName);
  return {
    id: row.id,
    direction: row.direction,
    status: row.status as BarberWaMessageDTO["status"],
    body: row.body,
    // Un recordatorio que invalidamos nosotros NO es un fallo que enseñarle a
    // la barbería como si Meta lo hubiera rechazado.
    error: isInvalidatedReminder(row.errorMessage) ? null : row.errorMessage,
    // Los adjuntos y las marcas de sistema no son "una plantilla".
    templateName:
      attachment || isBarberWaSysRow(row.templateName) ? null : row.templateName,
    attachment,
    createdAt: row.createdAt.toISOString(),
    appointmentId: row.appointmentId,
  };
}

/**
 * Hilos del Inbox, uno por teléfono.
 *
 * No hay tabla de hilos: se agrupa por `phone` dentro de la barbería. El
 * "archivado" sale de las marcas append-only (sys:archive / sys:unarchive):
 * archivar NUNCA borra un mensaje, y un mensaje nuevo desarchiva solo el
 * hilo porque es más reciente que la marca.
 */
export async function listBarberThreads(
  barbershopId: string,
  opts: { archived?: boolean; limit?: number } = {},
): Promise<BarberWaThreadDTO[]> {
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);

  // Se leen las últimas filas y se agrupa en memoria: una barbería maneja
  // decenas de conversaciones, no millones, y así el "archivado" (que vive
  // en marcas) se resuelve con los mismos datos y sin una segunda consulta.
  const rows = await prisma.barberMessage.findMany({
    where: { barbershopId },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { ...MESSAGE_SELECT, client: { select: { id: true, name: true } } },
  });

  type Acc = {
    phone: string;
    clientId: string | null;
    clientName: string | null;
    lastBody: string | null;
    lastAt: Date;
    lastDirection: "INBOUND" | "OUTBOUND";
    lastStatus: string;
    unread: number;
    /** La marca MÁS RECIENTE del hilo (la primera que se ve al ir desc). */
    marker: { archived: boolean; at: Date } | null;
    lastRealAt: Date | null;
    lastInboundAt: Date | null;
  };
  const byPhone = new Map<string, Acc>();

  for (const row of rows) {
    const key = row.phone;
    let acc = byPhone.get(key);
    if (!acc) {
      acc = {
        phone: key,
        clientId: null,
        clientName: null,
        lastBody: null,
        lastAt: row.createdAt,
        lastDirection: row.direction,
        lastStatus: row.status,
        unread: 0,
        marker: null,
        lastRealAt: null,
        lastInboundAt: null,
      };
      byPhone.set(key, acc);
    }
    if (row.client && !acc.clientId) {
      acc.clientId = row.client.id;
      acc.clientName = row.client.name;
    }

    if (isBarberWaSysRow(row.templateName)) {
      // Solo la PRIMERA marca que aparece cuenta: las filas vienen de la más
      // nueva a la más vieja, así que esa es la última decisión que tomó la
      // barbería. Una marca vieja no puede volver a archivar un hilo que ya
      // se desarchivó.
      if (!acc.marker) {
        acc.marker = {
          archived: row.templateName === BARBER_WA_ARCHIVE_MARK,
          at: row.createdAt,
        };
      }
      continue;
    }

    if (!acc.lastRealAt) {
      acc.lastRealAt = row.createdAt;
      acc.lastAt = row.createdAt;
      acc.lastBody = row.body;
      acc.lastDirection = row.direction;
      acc.lastStatus = row.status;
    }
    if (row.direction === "INBOUND" && !acc.lastInboundAt) {
      acc.lastInboundAt = row.createdAt;
    }
  }

  // Sin leer: entrantes después del último saliente del hilo.
  const lastOutbound = new Map<string, Date>();
  for (const row of rows) {
    if (isBarberWaSysRow(row.templateName)) continue;
    if (row.direction !== "OUTBOUND") continue;
    if (!lastOutbound.has(row.phone)) lastOutbound.set(row.phone, row.createdAt);
  }
  for (const row of rows) {
    if (isBarberWaSysRow(row.templateName)) continue;
    if (row.direction !== "INBOUND") continue;
    const acc = byPhone.get(row.phone);
    if (!acc) continue;
    const out = lastOutbound.get(row.phone);
    if (!out || row.createdAt > out) acc.unread++;
  }

  const now = new Date();
  const threads: BarberWaThreadDTO[] = [];
  for (const acc of Array.from(byPhone.values())) {
    // Archivado de verdad = la última marca dice "archivado" Y es más nueva
    // que el último mensaje real. Así un mensaje nuevo DESARCHIVA solo el
    // hilo (que es lo que espera cualquiera) sin borrar ni tocar nada.
    const archived = Boolean(
      acc.marker?.archived && (!acc.lastRealAt || acc.marker.at > acc.lastRealAt),
    );
    if (Boolean(opts.archived) !== archived) continue;
    if (!acc.lastRealAt) continue;
    threads.push({
      phone: acc.phone,
      clientId: acc.clientId,
      clientName: acc.clientName,
      lastBody: acc.lastBody,
      lastAt: acc.lastAt.toISOString(),
      lastDirection: acc.lastDirection,
      lastStatus: acc.lastStatus as BarberWaThreadDTO["lastStatus"],
      unread: archived ? 0 : acc.unread,
      archived,
      windowOpen: barberWaWindowOpen(acc.lastInboundAt, now),
    });
  }

  threads.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  return threads.slice(0, limit);
}

/** Mensajes de UN hilo. Acotado por barbershopId: nadie ve el hilo de otra. */
export async function listBarberThreadMessages(
  barbershopId: string,
  phone: string,
  limit = 200,
): Promise<{ messages: BarberWaMessageDTO[]; windowOpen: boolean; clientId: string | null; clientName: string | null }> {
  const clean = mxTenDigits(phone);
  if (!clean) return { messages: [], windowOpen: false, clientId: null, clientName: null };

  const rows = await prisma.barberMessage.findMany({
    where: { barbershopId, phone: clean },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
    select: { ...MESSAGE_SELECT, client: { select: { id: true, name: true } } },
  });

  const visible = rows.filter((r) => !isBarberWaSysRow(r.templateName));
  const lastIn = visible.find((r) => r.direction === "INBOUND");
  const withClient = rows.find((r) => r.client);

  return {
    messages: visible.reverse().map(toMessageDTO),
    windowOpen: barberWaWindowOpen(lastIn?.createdAt ?? null),
    clientId: withClient?.client?.id ?? null,
    clientName: withClient?.client?.name ?? null,
  };
}

/**
 * Archiva o desarchiva un hilo. NUNCA borra: escribe una marca con la fecha,
 * y la lista compara esa marca con el último mensaje real.
 */
export async function setBarberThreadArchived(
  barbershopId: string,
  phone: string,
  archived: boolean,
): Promise<boolean> {
  const clean = mxTenDigits(phone);
  if (!clean) return false;
  const exists = await prisma.barberMessage.findFirst({
    where: { barbershopId, phone: clean },
    select: { id: true },
  });
  if (!exists) return false;

  await prisma.barberMessage.create({
    data: {
      barbershopId,
      direction: "OUTBOUND",
      phone: clean,
      body: null,
      templateName: archived ? BARBER_WA_ARCHIVE_MARK : BARBER_WA_UNARCHIVE_MARK,
      // SENT y no PENDING: una marca no es un mensaje por enviar y el
      // drenaje jamás debe intentar mandarla.
      status: "SENT",
    },
  });
  return true;
}

/**
 * Envío manual desde el Inbox. Dentro de la ventana de 24 h sale como texto;
 * fuera de ella NO se manda un texto que Meta va a rechazar en silencio: se
 * devuelve el motivo para que la pantalla lo diga.
 */
export interface ManualSendOk {
  ok: true;
  messageId: string;
}
export interface ManualSendErr {
  ok: false;
  error: string;
  code?: string;
}
export type ManualSendResult = ManualSendOk | ManualSendErr;

/**
 * GUARDA DE TIPO — el repo compila con strict:false y ahí TypeScript NO
 * estrecha una unión por su discriminante booleano. Sin esto, `if (!r.ok)`
 * deja el tipo igual y leer `r.error` no compila. Mismo patrón que
 * isBookingGateOk en booking.ts.
 */
export function isManualSendError(result: ManualSendResult): result is ManualSendErr {
  return result.ok === false;
}

export async function sendBarberManualMessage(args: {
  barbershopId: string;
  phone: string;
  body: string;
}): Promise<ManualSendResult> {
  const phone = mxTenDigits(args.phone);
  if (!phone) return { ok: false, error: "El número debe tener 10 dígitos." };
  const body = args.body.trim();
  if (!body) return { ok: false, error: "Escribe un mensaje." };
  if (body.length > 4000) return { ok: false, error: "El mensaje es demasiado largo." };

  const shop = await loadShop(args.barbershopId);
  if (!shop) return { ok: false, error: "No se encontró la barbería." };
  const creds = resolveSenderCredentials(shop);
  if (!creds) {
    return { ok: false, error: "Conecta el WhatsApp de la barbería para poder escribir.", code: "NOT_CONNECTED" };
  }

  if (!barberWaWindowOpen(await lastInboundAt(shop.id, phone))) {
    return {
      ok: false,
      error:
        "Pasaron más de 24 horas desde el último mensaje del cliente. " +
        "Meta solo permite escribir primero con una plantilla aprobada.",
      code: "WINDOW_CLOSED",
    };
  }

  const quota = await getBarberWaQuota(shop.id);
  if (!barberWaFits(quota.limit, quota.used)) {
    return { ok: false, error: "Se acabaron los mensajes incluidos de este periodo.", code: "QUOTA" };
  }

  const client = await prisma.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId: shop.id, phone } },
    select: { id: true },
  });

  const row = await prisma.barberMessage.create({
    data: {
      barbershopId: shop.id,
      direction: "OUTBOUND",
      phone,
      body,
      status: "PENDING",
      clientId: client?.id ?? null,
    },
    select: { id: true },
  });

  try {
    const { wamid } = await sendText(creds, phone, body);
    await prisma.barberMessage.update({
      where: { id: row.id },
      data: { status: "SENT", waMessageId: wamid },
    });
    await consumeQuota(shop);
    return { ok: true, messageId: row.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo enviar";
    await prisma.barberMessage
      .update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: message } })
      .catch(() => {});
    return { ok: false, error: message };
  }
}

/* ──────────────────────────── multimedia ─────────────────────────────── */

/**
 * Metadatos + URL de descarga de un adjunto entrante, POR ID DE MENSAJE y
 * acotado por barbershopId.
 *
 * Se indexa por messageId y NO por mediaId a propósito: con el mediaId en la
 * URL, cualquiera con un id ajeno sacaría el archivo de OTRA barbería usando
 * nuestro token. Con el messageId, el filtro por la barbería de la sesión lo
 * impide de raíz.
 *
 * CERO archivos en Storage: Meta los borra a los ~30 días y guardarlos sería
 * pagar por copias que caducan igual.
 */
export interface BarberMediaOk {
  ok: true;
  url: string;
  mimeType: string;
  filename: string | null;
  /** Token descifrado, SOLO para la cabecera del proxy. Nunca al navegador. */
  token: string;
}
export interface BarberMediaErr {
  ok: false;
  reason: "not_found" | "expired" | "not_connected" | "upstream";
}
export type BarberMediaResult = BarberMediaOk | BarberMediaErr;

/** GUARDA DE TIPO (strict:false no estrecha por booleano). Ver isManualSendError. */
export function isBarberMediaOk(result: BarberMediaResult): result is BarberMediaOk {
  return result.ok === true;
}

export async function resolveBarberMedia(
  barbershopId: string,
  messageId: string,
): Promise<BarberMediaResult> {
  const row = await prisma.barberMessage.findFirst({
    where: { id: messageId, barbershopId },
    select: { templateName: true },
  });
  if (!row) return { ok: false, reason: "not_found" };

  const att = parseBarberWaAttachment(row.templateName);
  if (!att) return { ok: false, reason: "not_found" };

  const shop = await loadShop(barbershopId);
  const creds = shop ? resolveSenderCredentials(shop) : null;
  if (!creds) return { ok: false, reason: "not_connected" };

  try {
    const meta = await getWhatsAppMediaMeta(creds.accessToken, att.mediaId);
    if (!meta) return { ok: false, reason: "expired" };
    return {
      ok: true,
      url: meta.url,
      mimeType: att.mime || meta.mimeType,
      filename: att.filename ?? null,
      token: creds.accessToken,
    };
  } catch {
    return { ok: false, reason: "upstream" };
  }
}

/* ──────────────────────── conexión / desconexión ─────────────────────── */

/**
 * Guarda las credenciales que devolvió el Embedded Signup. El token se
 * cifra en reposo (envelope), igual que en el dental.
 */
export async function saveBarberWaConnection(args: {
  barbershopId: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  verified: boolean;
}): Promise<void> {
  await prisma.barbershop.update({
    where: { id: args.barbershopId },
    data: {
      whatsappSenderMode: "OWN_WABA",
      wabaId: args.wabaId,
      phoneNumberId: args.phoneNumberId,
      whatsappToken: encryptField(args.token),
      // Sin verificación de negocio NO se marca verificado, pero tampoco es
      // un error: son 250 clientes únicos cada 24 h.
      whatsappVerifiedAt: args.verified ? new Date() : null,
    },
  });
}

/** Desconecta. Los mensajes NO se borran: el historial es de la barbería. */
export async function disconnectBarberWa(barbershopId: string): Promise<void> {
  await prisma.barbershop.update({
    where: { id: barbershopId },
    data: { wabaId: null, phoneNumberId: null, whatsappToken: null, whatsappVerifiedAt: null },
  });
}
