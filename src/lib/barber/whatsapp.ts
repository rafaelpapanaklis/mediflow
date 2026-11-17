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
// Del WhatsApp del dental se IMPORTA (no se edita) solo lo que es puro: el
// armado de botones/listas con los límites de Meta y el flujo de la nota de
// voz, que recibe por inyección todo lo que toca el mundo de fuera.
import {
  construirInteractivo,
  interactivoParaOpciones,
  lineaDeOpciones,
  type MensajeInteractivo,
} from "@/lib/whatsapp/interactivo";
import {
  VENTANA_VOZ_SEG,
  VOZ_POR_REMITENTE,
  procesarNotaDeVoz,
  type DepsNotaDeVoz,
  type ResultadoNotaDeVoz,
} from "@/lib/whatsapp/bot/nota-de-voz-core";
import {
  BARBER_BOT_OPTION_ID_PREFIX,
  isBarberBotOptionId,
  type BarberBotOption,
} from "@/lib/barber/bot-core";
import { mxTenDigits } from "@/lib/phone-mx";
import { getBarberPlan } from "@/lib/barber/plans";
import { isBarbershopSubscriptionActive, barberPlanHasFeature } from "@/lib/barber/plan-shared";
import {
  BARBER_REMINDER_INVALIDATED_MARK,
  BARBER_WALKIN_NOTIFY_TEMPLATE,
  isInvalidatedReminder,
  pendingReminderInvalidationWhere,
  reminderInvalidationData,
} from "@/lib/barber/agenda";
import { canTransition, type BarberAppointmentStatus } from "@/lib/barber/types";
import {
  advisoryLockKey,
  barberTodayISO,
  barberTzLocalToUtc,
} from "@/lib/barber/booking-core";
import {
  BARBER_WA_ACK_MARK,
  barberWaAckText,
  decideBarberWaAck,
  isBarberWaAckRow,
  type BarberWaAckDecision,
} from "@/lib/barber/wa-acuse-core";
import { getBarberWaAck } from "@/lib/barber/wa-acuse";
import { wabaIdsFromDebugToken } from "@/lib/barber/wa-signup-core";
import { cleanNoticePhone, type OrderNoticeKind } from "@/lib/barber/pedido-avisos-core";
import {
  decideOwnerWa,
  parseOwnerOrderWaBody,
  renderOwnerOrderWaText,
  type OwnerWaDecision,
} from "@/lib/barber/pedido-avisos-wa-core";
import {
  decideBarberTemplateNameTaken,
  isBarberTemplateNameTaken,
  pickBarberTemplateRow,
  readBarberTemplateFailure,
  type BarberTemplateFailure,
  type MetaTemplateRow,
} from "@/lib/barber/wa-plantillas-core";
import {
  BARBER_WA_ARCHIVE_MARK,
  BARBER_WA_CLAIM_LOST_MESSAGE,
  BARBER_WA_CLAIM_STALE_MS,
  BARBER_WA_LANG,
  BARBER_WA_OPT_OUT_REPLY,
  BARBER_WA_SYS_PREFIX,
  BARBER_WA_VOICE_BODY_PREFIXES,
  BARBER_WA_VOICE_FAILED_REPLY,
  BARBER_WA_VOICE_HINT,
  BARBER_WA_VOICE_TOO_LONG_REPLY,
  barberWaOptionsAsText,
  BARBER_WA_TEMPLATES,
  BARBER_WA_UNARCHIVE_MARK,
  barberClientOptedOut,
  barberOutboxStaleReason,
  barberWaClaimMark,
  barberWaFits,
  barberWaTemplate,
  barberWaWindowOpen,
  buildBarberWaQuota,
  BARBER_REQUEST_SOURCES,
  BARBER_WA_CANCEL_ASK,
  barberBookingRejectedText,
  barberBotReplyIsStale,
  barberBotTurnMark,
  BARBER_WA_TURN_PREFIX,
  decideBarberBotTurn,
  isBarberBotTurnMark,
  barberCancelAskButtons,
  barberLateChangeReply,
  barberReminderButtons,
  barberTooLateToChange,
  countBarberWaVariables,
  decideBarberReminderReply,
  encodeBarberWaAttachment,
  isBarberOptOutText,
  isBarberUnacceptedRequest,
  isBarberWaAskRow,
  isBarberWaClaim,
  isBarberWaSysRow,
  parseBarberReminderButton,
  type BarberReminderAction,
  type BarberWaButton,
  nextBarberWaStatus,
  parseBarberWaAttachment,
  parseBarberWaClaim,
  reminderAlreadyHandled,
  sanitizeBarberWaParam,
  walkInTemplateNotice,
  type BarberOutboxKind,
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
/**
 * No se recuerda una visita creada hace menos de esto (decisión de Rafael,
 * ronda 2). Una cita de hoy para dentro de dos horas ya no recibe
 * recordatorio: le basta la confirmación. Una de hoy para mañana lo recibe a
 * partir de las tres horas de haberse agendado.
 */
export const REMINDER_MIN_AGE_MS = 3 * 60 * 60 * 1000;

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
  /** Teléfono de la barbería (el que se le da al cliente para llamar). */
  phone: string | null;
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
  phone: true,
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

/* ─────────────── descifrar el token SIN tumbar a nadie ─────────────── */

/**
 * `decryptField` (helper compartido con el dental, NO se toca) LANZA si el
 * dato se cifró con otra llave: llave rotada, un entorno con otra
 * DATA_ENCRYPTION_KEY (panel.108 con un token de producción, 15-nov-2026),
 * dato dañado o la variable sin poner. Antes eso tumbaba /barber/whatsapp
 * entera («No se pudo mostrar esta pantalla») y podía tumbar el cron.
 *
 * Aquí se envuelve: el error se registra (sin el token, como mucho una vez
 * cada 10 min por barbería y proceso) y se devuelve `ok: false`. Quien
 * llama trata eso como «sin credenciales» = hay que volver a conectar.
 */
const TOKEN_WARN_EVERY_MS = 10 * 60 * 1000;
const tokenWarnedAt = new Map<string, number>();

export function readBarberWaSecret(
  raw: string | null | undefined,
  who: string,
): { ok: true; value: string | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: decryptField(raw) ?? raw };
  } catch (err) {
    const now = Date.now();
    if (now - (tokenWarnedAt.get(who) ?? 0) > TOKEN_WARN_EVERY_MS) {
      tokenWarnedAt.set(who, now);
      console.error(
        `[barber/wa] no se pudo descifrar el token de WhatsApp (${who}): ` +
          `${err instanceof Error ? err.message : "error"}. Se trata como «hay que volver a conectar».`,
      );
    }
    return { ok: false };
  }
}

/** ¿Esta barbería tiene un token guardado que NO se puede descifrar? */
export function barberWaTokenUnreadable(shop: Pick<ShopWaRow, "id" | "whatsappToken">): boolean {
  if (!shop.whatsappToken) return false;
  return readBarberWaSecret(shop.whatsappToken, shop.id).ok === false;
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
    // Nunca lanza: un token que no se puede descifrar = sin credenciales.
    const read = readBarberWaSecret(shop.whatsappToken, shop.id);
    if (read.ok === false) return null;
    const token = read.value;
    if (!token) return null;
    return { ...base, phoneNumberId: shop.phoneNumberId, accessToken: token, wabaId: shop.wabaId };
  }

  // PLATFORM — apagado por bandera; el camino queda escrito y documentado.
  const phoneNumberId = process.env.BARBER_WA_PLATFORM_PHONE_NUMBER_ID;
  const rawToken = process.env.BARBER_WA_PLATFORM_TOKEN;
  if (!phoneNumberId || !rawToken) return null;
  const platform = readBarberWaSecret(rawToken, "plataforma");
  if (platform.ok === false || !platform.value) return null;
  return {
    ...base,
    phoneNumberId,
    accessToken: platform.value,
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
      webhookSubscribed: null,
    };
  }

  const connected = Boolean(shop.phoneNumberId && shop.whatsappToken);
  let state: BarberWaConnectionState = connected
    ? shop.whatsappVerifiedAt
      ? "CONNECTED"
      : "UNVERIFIED"
    : "DISCONNECTED";
  let problem: string | null = null;
  let problemCode: BarberWaConnectionDTO["problemCode"] = null;
  let displayPhone: string | null = null;
  let webhookSubscribed: boolean | null = null;

  // El token guardado no se puede descifrar (llave rotada, otro entorno):
  // la conexión queda en «hay que volver a conectar» y el resto de la
  // pantalla se pinta igual. Ni se consulta a Meta: no hay con qué.
  if (connected && barberWaTokenUnreadable(shop)) {
    return {
      state: "ERROR",
      senderMode: shop.whatsappSenderMode,
      displayPhone: null,
      wabaId: shop.wabaId,
      phoneNumberId: shop.phoneNumberId,
      verifiedAt: shop.whatsappVerifiedAt ? shop.whatsappVerifiedAt.toISOString() : null,
      problem: "No pudimos leer la llave de tu conexión con WhatsApp. Vuelve a conectar tu número.",
      problemCode: "TOKEN_UNREADABLE",
      canConnect,
      webhookSubscribed: null,
    };
  }

  if (connected) {
    // Último fallo REAL de Meta (excluye los recordatorios que invalidamos
    // nosotros al mover una cita: eso no es un problema de la conexión).
    const lastFail = await prisma.barberMessage.findFirst({
      where: { barbershopId, direction: "OUTBOUND", status: "FAILED" },
      orderBy: { createdAt: "desc" },
      select: { errorMessage: true, createdAt: true },
    });
    const msg = lastFail?.errorMessage ?? null;
    // Ese fallo deja de ser «el estado de la conexión» en cuanto algo lo
    // desmiente: se volvió a conectar DESPUÉS, o un mensaje posterior sí
    // salió. Sin esto el aviso rojo se quedaba pegado con todo ya arreglado,
    // hasta que hubiera OTRO fallo distinto.
    let superseded = false;
    if (lastFail && msg && !isInvalidatedReminder(msg)) {
      superseded =
        Boolean(shop.whatsappVerifiedAt && shop.whatsappVerifiedAt > lastFail.createdAt) ||
        Boolean(
          await prisma.barberMessage.findFirst({
            where: {
              barbershopId,
              direction: "OUTBOUND",
              status: { in: ["SENT", "DELIVERED", "READ"] },
              createdAt: { gt: lastFail.createdAt },
            },
            select: { id: true },
          }),
        );
    }
    if (msg && !isInvalidatedReminder(msg) && !superseded) {
      if (msg.includes(`(#${WA_ERROR_CODE.BILLING_REQUIRED})`)) {
        state = "NO_PAYMENT_METHOD";
        problem = msg;
      } else if (msg.includes(`(#${WA_ERROR_CODE.TOKEN_EXPIRED})`)) {
        state = "ERROR";
        problem = msg;
      }
    }

    // Y lo que Meta dice AHORA MISMO: ¿el token sigue vivo?, ¿nos entrega lo
    // que escriben los clientes? Una conexión puede verse perfecta aquí y
    // estar muerta allá; esto es lo que lo delata sin esperar al primer
    // mensaje fallido.
    const creds = resolveSenderCredentials(shop);
    if (creds) {
      const live = await probeBarberWa(creds);
      displayPhone = live.displayPhone;
      webhookSubscribed = live.webhookSubscribed;
      if (live.tokenError) {
        state = "ERROR";
        problem = live.tokenError;
      }
    }
  }

  return {
    state,
    senderMode: shop.whatsappSenderMode,
    displayPhone,
    wabaId: shop.wabaId,
    phoneNumberId: shop.phoneNumberId,
    verifiedAt: shop.whatsappVerifiedAt ? shop.whatsappVerifiedAt.toISOString() : null,
    problem,
    problemCode,
    canConnect,
    webhookSubscribed,
  };
}

/** Lo que tarda como mucho la comprobación en vivo (la pantalla espera). */
const PROBE_TIMEOUT_MS = 6000;

/**
 * Suscribe NUESTRA app a la cuenta de WhatsApp (WABA) de la barbería. Sin
 * esto Meta no nos manda a nuestro webhook lo que escriben sus clientes.
 * Devuelve si quedó suscrita.
 */
export async function subscribeBarberWaba(wabaId: string, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * ¿`GET /{wabaId}/phone_numbers`, con ESE token, lista el número? Es la
 * prueba de que el número que llega del navegador es de la cuenta que se
 * acaba de autorizar. Cualquier respuesta que no sea ok cuenta como «no».
 * (Misma comprobación que el alta del dental, que la añadió tras una
 * auditoría de seguridad.)
 */
export async function barberWabaOwnsPhone(
  wabaId: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<boolean> {
  let url: string | null = `${GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`;
  try {
    for (let page = 0; url && page < 5; page++) {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return false;
      const json: any = await res.json().catch(() => null);
      const ids: string[] = Array.isArray(json?.data)
        ? json.data.map((n: any) => String(n?.id ?? ""))
        : [];
      if (ids.includes(phoneNumberId)) return true;
      const next = json?.paging?.next;
      url = typeof next === "string" && next.startsWith(`${GRAPH}/`) ? next : null;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Los números que `GET /{wabaId}/phone_numbers` lista con ESE token (hasta
 * 5 páginas). null = Meta no contestó bien (no es lo mismo que «ninguno»).
 */
export async function listBarberWabaPhones(wabaId: string, accessToken: string): Promise<string[] | null> {
  let url: string | null = `${GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`;
  const out: string[] = [];
  try {
    for (let page = 0; url && page < 5; page++) {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const json: any = await res.json().catch(() => null);
      for (const n of Array.isArray(json?.data) ? json.data : []) {
        const id = String(n?.id ?? "");
        if (id && !out.includes(id)) out.push(id);
      }
      const next = json?.paging?.next;
      url = typeof next === "string" && next.startsWith(`${GRAPH}/`) ? next : null;
    }
  } catch {
    return null;
  }
  return out;
}

/**
 * Las cuentas de WhatsApp Business que la persona compartió con la app al
 * terminar el Embedded Signup, leídas del propio token (`GET /debug_token`,
 * `granular_scopes`). Es la vía que Meta documenta para cuando el navegador
 * no recibió el evento FINISH con el waba_id. [] si Meta no contesta.
 */
export async function sharedBarberWabaIds(
  accessToken: string,
  app: { id: string; secret: string },
): Promise<string[]> {
  try {
    const res = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}` +
        `&access_token=${encodeURIComponent(`${app.id}|${app.secret}`)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return [];
    return wabaIdsFromDebugToken(await res.json().catch(() => null));
  } catch {
    return [];
  }
}

/**
 * Comprobación EN VIVO de una conexión. Nunca lanza y nunca tarda más que
 * PROBE_TIMEOUT_MS: lo que no se pudo saber vuelve como null, no como error.
 *
 * Si nuestra app NO está suscrita a la WABA se intenta suscribirla aquí
 * mismo (es idempotente): que la barbería tenga que "reconectar" para algo
 * que se arregla con una llamada sería trabajo de más.
 */
async function probeBarberWa(creds: BarberWaCredentials): Promise<{
  displayPhone: string | null;
  webhookSubscribed: boolean | null;
  tokenError: string | null;
}> {
  const headers = { Authorization: `Bearer ${creds.accessToken}` };

  const phone = (async () => {
    try {
      const res = await fetch(
        `${GRAPH}/${encodeURIComponent(creds.phoneNumberId)}?fields=display_phone_number,verified_name`,
        { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
      );
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = parseWaError(json, res.status);
        // Solo el token caducado/revocado es un veredicto. Cualquier otro
        // tropiezo (Meta lento, 5xx) no dice nada de la conexión.
        return {
          displayPhone: null,
          tokenError: err.code === WA_ERROR_CODE.TOKEN_EXPIRED ? err.message : null,
        };
      }
      const shown =
        typeof json?.display_phone_number === "string" && json.display_phone_number
          ? json.display_phone_number
          : null;
      return { displayPhone: shown, tokenError: null };
    } catch {
      return { displayPhone: null, tokenError: null };
    }
  })();

  const subscription = (async (): Promise<boolean | null> => {
    if (!creds.wabaId) return null;
    try {
      const res = await fetch(`${GRAPH}/${encodeURIComponent(creds.wabaId)}/subscribed_apps`, {
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const json: any = await res.json().catch(() => null);
      const apps: any[] = Array.isArray(json?.data) ? json.data : [];
      const ourId = process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID ?? null;
      const ids = apps.map((a) => String(a?.whatsapp_business_api_data?.id ?? ""));
      const subscribed = ourId ? ids.includes(String(ourId)) : apps.length > 0;
      if (subscribed) return true;
      return await subscribeBarberWaba(creds.wabaId, creds.accessToken);
    } catch {
      return null;
    }
  })();

  const [p, webhookSubscribed] = await Promise.all([phone, subscription]);
  return { displayPhone: p.displayPhone, webhookSubscribed, tokenError: p.tokenError };
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
  /**
   * `payload` de cada botón de respuesta rápida, en el orden de
   * `tpl.buttons`. Es lo que Meta nos devuelve en el webhook cuando el
   * cliente toca el botón (formato del dental: componentesDeRespuestaRapida
   * en src/lib/whatsapp/interactivo.ts).
   */
  buttonPayloads: string[] = [],
) {
  // 🔴 Un salto de línea, una tabulación o un parámetro vacío hacen que
  // Meta rechace el mensaje ENTERO (132018 / 131008). Se sanea aquí, en el
  // único punto por el que sale toda plantilla, y no en cada emisor.
  const clean = params.map((text) => sanitizeBarberWaParam(text));
  const components: Record<string, unknown>[] = [];
  if (clean.length > 0) {
    components.push({
      type: "body",
      parameters: clean.map((text) => ({ type: "text", text })),
    });
  }
  if (tpl.category === "AUTHENTICATION") {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: clean[0] ?? "" }],
    });
  }
  (tpl.buttons ?? []).forEach((_label, i) => {
    const payload = buttonPayloads[i];
    if (!payload) return;
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(i),
      parameters: [{ type: "payload", payload }],
    });
  });

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
  /**
   * Código de rechazo de Meta (INVALID_FORMAT…), SOLO si está rechazada y
   * hay un motivo real. Nunca «NONE». La pantalla lo traduce.
   */
  reason: string | null;
  optional: boolean;
  /** Idioma en el que Meta la tiene (null si falta). */
  language?: string | null;
  /** true = Meta solo la tiene en OTRO idioma: con ésa no se puede mandar. */
  otherLanguage?: boolean;
}

/**
 * TODAS las plantillas de la WABA, siguiendo la paginación de Meta (hasta 10
 * páginas). Antes se leía una sola página: si la nuestra caía en la segunda,
 * la pantalla decía «Sin dar de alta» aunque Meta la tuviera. Lanza
 * WhatsAppApiError si Meta contesta mal.
 */
async function fetchBarberTemplateRows(
  creds: BarberWaCredentials,
  opts: { name?: string } = {},
): Promise<MetaTemplateRow[]> {
  const rows: MetaTemplateRow[] = [];
  let url: string | null =
    `${GRAPH}/${encodeURIComponent(creds.wabaId!)}/message_templates?limit=200` +
    `&fields=name,status,category,language,rejected_reason` +
    (opts.name ? `&name=${encodeURIComponent(opts.name)}` : "");
  for (let page = 0; url && page < 10; page++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw parseWaError(json, res.status);
    for (const row of Array.isArray(json?.data) ? json.data : []) {
      if (typeof row?.name !== "string") continue;
      // Con `name=` Meta busca por PARECIDO: solo cuenta el nombre exacto.
      if (opts.name && row.name !== opts.name) continue;
      rows.push({
        name: row.name,
        status: String(row.status ?? "PENDING"),
        language: typeof row.language === "string" ? row.language : null,
        rejectedReason: typeof row.rejected_reason === "string" ? row.rejected_reason : null,
      });
    }
    const next = json?.paging?.next;
    url = typeof next === "string" && next.startsWith(`${GRAPH}/`) ? next : null;
  }
  return rows;
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
      // Botones de respuesta rápida (el recordatorio con botones). Misma
      // forma que la propuesta del dental (payloadAltaPlantillaConBotones).
      ...(tpl.buttons && tpl.buttons.length > 0
        ? [{ type: "BUTTONS", buttons: tpl.buttons.map((text) => ({ type: "QUICK_REPLY", text })) }]
        : []),
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
      reason: barberWaTokenUnreadable(shop)
        ? "No pudimos leer la llave de tu conexión con WhatsApp. Vuelve a conectar tu número para ver y dar de alta las plantillas."
        : "Conecta el WhatsApp de la barbería para poder dar de alta las plantillas.",
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

  let rows: MetaTemplateRow[] = [];
  try {
    rows = await fetchBarberTemplateRows(creds);
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
      // La del idioma con el que mandamos; si solo hay otra, marcada. El
      // motivo de rechazo nunca es «NONE» (pickBarberTemplateRow lo filtra).
      const found = pickBarberTemplateRow(rows, t.name, t.lang);
      return {
        kind: t.kind,
        name: t.name,
        category: t.category,
        status: found?.status ?? "MISSING",
        reason: found?.reason ?? null,
        optional: t.optional,
        language: found?.language ?? null,
        otherLanguage: found?.otherLanguage ?? false,
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
): Promise<{
  ok: boolean;
  reason?: string;
  created: string[];
  /**
   * Las que Meta no aceptó, con TODO lo que dijo (código, subcódigo,
   * error_user_title, error_user_msg). `error` es el texto de siempre.
   */
  failed: Array<BarberTemplateFailure & { error: string; kind: BarberWaKind }>;
}> {
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
  // Existe = Meta la tiene EN NUESTRO IDIOMA (con el estado que sea). Si solo
  // la tiene en otro, se pide la versión es_MX: Meta deja varios idiomas con
  // el mismo nombre.
  const existing = new Set(
    current.ok
      ? current.templates.filter((t) => t.status !== "MISSING" && !t.otherLanguage).map((t) => t.name)
      : [],
  );

  const created: string[] = [];
  const failed: Array<BarberTemplateFailure & { error: string; kind: BarberWaKind }> = [];

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
      // Lo útil de Meta suele venir en error_user_msg, no en message.
      const detail = readBarberTemplateFailure(tpl.name, tpl.category, json);
      // «Ya existe»: NUNCA en silencio. Se busca POR NOMBRE para ver cómo
      // la tiene Meta. Si está y sirve, no hay nada que avisar (la lista la
      // enseña con su estado real); si no la lista (se está borrando) o está
      // en un estado/idioma que no sirve, se avisa como fallo.
      if (isBarberTemplateNameTaken(detail)) {
        let found: ReturnType<typeof pickBarberTemplateRow> = null;
        try {
          found = pickBarberTemplateRow(await fetchBarberTemplateRows(creds, { name: tpl.name }), tpl.name, tpl.lang);
        } catch {
          found = null;
        }
        const verdict = decideBarberTemplateNameTaken(found);
        if (verdict === "ok") continue;
        failed.push({
          ...detail,
          kind: tpl.kind,
          taken: verdict,
          foundStatus: found?.status ?? null,
          foundLanguage: found?.language ?? null,
          error: detail.userMsg ?? err.message,
        });
        continue;
      }
      failed.push({
        ...detail,
        kind: tpl.kind,
        error: detail.userMsg ?? err.message,
        code: detail.code ?? (res.status === 401 ? 190 : null),
      });
    } catch (e) {
      failed.push({
        name: tpl.name,
        kind: tpl.kind,
        category: tpl.category,
        network: true,
        message: e instanceof Error ? e.name : null,
        error: e instanceof Error ? e.message : "Error de red",
      });
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

/** Lo que la cola necesita leer de cada fila. */
const OUTBOX_ROW_SELECT = {
  id: true,
  phone: true,
  body: true,
  templateName: true,
  appointmentId: true,
  errorMessage: true,
  createdAt: true,
} as const;

type OutboxRow = {
  id: string;
  phone: string;
  body: string | null;
  templateName: string | null;
  appointmentId: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

function outboxKindOf(templateName: string | null): BarberOutboxKind {
  // La fila que encola T1 desde la fila virtual trae SU propio discriminador.
  if (templateName === BARBER_WALKIN_NOTIFY_TEMPLATE) return "walkinTurn";
  if (templateName === barberWaTemplate("reminder").name) return "reminder";
  if (templateName === barberWaTemplate("bookingConfirmed").name) return "bookingConfirmed";
  // El aviso «pedido nuevo» al DUEÑO (pedido-avisos-wa-core.ts).
  if (templateName === barberWaTemplate("ownerOrder").name) return "ownerOrder";
  return "other";
}

/**
 * De la fila de la cola a lo que se manda: el TEXTO (para la ventana
 * abierta) y la PLANTILLA con sus parámetros (para fuera de ella).
 *
 * Los dos se RECALCULAN aquí leyendo la cita: así el mensaje sale siempre
 * con la hora que la cita tiene AHORA, no con la que tenía cuando se
 * encoló. (En el dental ese desfase es el bug M-22: al reagendar, al
 * paciente le llegaba el aviso de la hora vieja. T1 además invalida la fila
 * anterior — ver scheduleBarberReminders.)
 */
function planDelivery(
  shop: ShopWaRow,
  row: OutboxRow,
  kind: BarberOutboxKind,
  appt: ApptForMessage | null,
): {
  text: string | null;
  template: { tpl: BarberWaTemplate; params: string[] } | null;
  /** Botones de respuesta para cuando sale como texto (ventana abierta). */
  buttons?: BarberWaButton[];
  /** Plantilla CON botones que se intenta antes que `template`. */
  buttonsTemplate?: { tpl: BarberWaTemplate; params: string[]; payloads: string[] };
} {
  if (kind === "walkinTurn") {
    const body = (row.body ?? "").trim() || "Ya casi es tu turno.";
    return {
      text: body,
      template: {
        tpl: barberWaTemplate("walkinTurn"),
        params: [shop.name, walkInTemplateNotice(shop.name, body)],
      },
    };
  }
  if (kind === "reminder" && appt) {
    const params = reminderParamsFrom(shop, appt);
    // Los tres botones llevan la visita en su id: con la ventana abierta van
    // como botones de respuesta, y fuera de ella como `payload` de los
    // botones de la plantilla. En los dos casos el toque dice EXACTAMENTE
    // qué visita confirmar, cambiar o cancelar.
    const buttons = barberReminderButtons(appt.id);
    return {
      text: renderReminderText(params),
      template: { tpl: barberWaTemplate("reminder"), params },
      buttons,
      buttonsTemplate: {
        tpl: barberWaTemplate("reminderButtons"),
        params,
        payloads: buttons.map((b) => b.id),
      },
    };
  }
  if (kind === "bookingConfirmed" && appt) {
    const params = bookingParamsFrom(shop, appt);
    return {
      text: renderBookingText(params),
      template: { tpl: barberWaTemplate("bookingConfirmed"), params },
    };
  }
  if (kind === "ownerOrder") {
    // El cuerpo de la fila ES el texto libre (un dato por renglón); de él
    // salen los tres parámetros de la plantilla, en su orden. Si alguien
    // encolara esta plantilla con otro cuerpo, no hay parámetros: solo texto.
    const params = parseOwnerOrderWaBody(row.body);
    return {
      text: (row.body ?? "").trim() || null,
      template: params ? { tpl: barberWaTemplate("ownerOrder"), params } : null,
    };
  }
  return { text: (row.body ?? "").trim() || null, template: null };
}

type OutboxOutcome = "sent" | "failed" | "stale" | "busy" | "lost" | "noQuota" | "waiting";

/** Lo que se le dice a quien mira la fila mientras Meta aprueba la plantilla. */
const TEMPLATE_PENDING_MESSAGE =
  "La plantilla de este aviso todavía no está aprobada por Meta (#132001). " +
  "Revisa su estado en WhatsApp → Plantillas.";

/**
 * Procesa UNA fila de la cola: decide si todavía tiene sentido, la RECLAMA
 * y la manda.
 *
 * REGLA DE COSTO: si la ventana de 24 h está abierta va como TEXTO — Meta no
 * cobra las plantillas de utilidad entregadas dentro de una ventana de
 * servicio abierta, y el texto además se lee mejor. Fuera de la ventana, la
 * plantilla es la ÚNICA vía.
 *
 * 🔴 SIN DUPLICADOS: la fila se reclama con un updateMany condicionado
 * (status PENDING + errorMessage null → marca "[enviando]"). Si dos pasadas
 * se enciman, solo una lo consigue; la otra la deja pasar. Nunca lanza.
 */
async function processOutboxRow(
  shop: ShopWaRow,
  creds: BarberWaCredentials,
  row: OutboxRow,
  opts: {
    hasQuota: boolean;
    now?: Date;
    /**
     * Plantillas que Meta ya rechazó por "no existe / no está aprobada" en
     * esta misma pasada: a las demás filas que la necesitan no se les
     * vuelve a preguntar (serían decenas de llamadas con la misma respuesta).
     */
    pendingTemplates?: Set<string>;
  },
): Promise<{ outcome: OutboxOutcome; error: string | null }> {
  const now = opts.now ?? new Date();

  try {
    // ── ¿La está mandando otra pasada? ────────────────────────────────
    const claimedAt = parseBarberWaClaim(row.errorMessage);
    if (claimedAt) {
      if (now.getTime() - claimedAt.getTime() < BARBER_WA_CLAIM_STALE_MS) {
        return { outcome: "busy", error: null };
      }
      // Reclamo viejo: quien la tomó murió a mitad del envío. No se sabe si
      // Meta la aceptó, así que NO se reintenta (no-duplicar pesa más que
      // no-perder): queda como fallida con el motivo a la vista.
      await prisma.barberMessage.updateMany({
        where: { id: row.id, status: "PENDING", errorMessage: row.errorMessage },
        data: { status: "FAILED", errorMessage: BARBER_WA_CLAIM_LOST_MESSAGE },
      });
      return { outcome: "lost", error: BARBER_WA_CLAIM_LOST_MESSAGE };
    }

    // ── ¿Todavía tiene sentido mandarla? ──────────────────────────────
    const kind = outboxKindOf(row.templateName);
    const appt =
      (kind === "reminder" || kind === "bookingConfirmed") && row.appointmentId
        ? await loadAppt(shop.id, row.appointmentId)
        : null;
    const stale = barberOutboxStaleReason({
      kind,
      createdAt: row.createdAt,
      now,
      appointment: appt ? { status: appt.status, startAt: appt.startAt } : null,
    });
    if (stale) {
      // Misma marca que usa T1 al mover una cita: no es un rechazo de Meta y
      // la pantalla no lo enseña como un problema de la conexión.
      await prisma.barberMessage.updateMany({
        where: { id: row.id, status: "PENDING", errorMessage: null },
        data: { status: "FAILED", errorMessage: `${BARBER_REMINDER_INVALIDATED_MARK} ${stale}` },
      });
      return { outcome: "stale", error: stale };
    }

    // Cupo agotado: NO se falla la fila ni se borra. Se queda esperando al
    // siguiente periodo y la pantalla ya venía avisando desde el 80 %.
    if (!opts.hasQuota) return { outcome: "noQuota", error: null };

    // ── Reclamo: de aquí en adelante la fila es de ESTA pasada ────────
    const claim = await prisma.barberMessage.updateMany({
      where: { id: row.id, status: "PENDING", errorMessage: null },
      data: { errorMessage: barberWaClaimMark(now) },
    });
    if (claim.count === 0) return { outcome: "busy", error: null };

    // 🔴 LA PLANTILLA TODAVÍA NO ESTÁ APROBADA (132001). Al conectar el
    // número, Meta tarda de minutos a horas en aprobar las plantillas. Si la
    // cola intentaba mandar en ese hueco, el recordatorio quedaba FAILED
    // para siempre (un fallo real de Meta no se reprograma): la barbería
    // conectaba a las 10:00 y perdía los recordatorios de todo el día
    // siguiente. Ahora la fila SE QUEDA EN COLA (se suelta el reclamo) y la
    // siguiente pasada lo vuelve a intentar; si la visita llega antes que la
    // aprobación, caduca sola por barberOutboxStaleReason.
    const waitForTemplate = async (tplName: string) => {
      opts.pendingTemplates?.add(tplName);
      await prisma.barberMessage
        .updateMany({ where: { id: row.id, status: "PENDING" }, data: { errorMessage: null } })
        .catch(() => {});
      return { outcome: "waiting" as const, error: TEMPLATE_PENDING_MESSAGE };
    };

    let wamid: string | null;
    try {
      const plan = planDelivery(shop, row, kind, appt);
      const windowOpen = barberWaWindowOpen(await lastInboundAt(shop.id, row.phone), now);
      if (windowOpen && plan.text) {
        // Ventana abierta: texto libre (gratis). El recordatorio lleva además
        // sus tres botones; si Meta rechaza el interactivo, sale el texto
        // solo, que ya dice qué responder.
        const rich = plan.buttons
          ? buildInteractive(
              plan.text,
              plan.buttons.map((b) => ({ id: b.id, titulo: b.title })),
            )
          : null;
        if (rich) {
          try {
            wamid = (await sendInteractive(creds, row.phone, rich.interactive)).wamid;
          } catch (err) {
            if (!(err instanceof WhatsAppApiError)) throw err;
            wamid = (await sendText(creds, row.phone, plan.text)).wamid;
          }
        } else {
          wamid = (await sendText(creds, row.phone, plan.text)).wamid;
        }
      } else if (plan.template) {
        // Fuera de la ventana solo cabe una plantilla. Primero la que lleva
        // BOTONES (si este aviso tiene una); si Meta la rechaza o todavía no
        // la aprueba, la de TEXTO, que es el respaldo. Solo si tampoco la de
        // texto está aprobada la fila se queda esperando.
        let sent: { wamid: string | null } | null = null;
        if (plan.buttonsTemplate && !opts.pendingTemplates?.has(plan.buttonsTemplate.tpl.name)) {
          try {
            sent = await sendTemplate(
              creds,
              row.phone,
              plan.buttonsTemplate.tpl,
              plan.buttonsTemplate.params,
              plan.buttonsTemplate.payloads,
            );
          } catch (err) {
            // Un timeout NO cae al respaldo: el mensaje pudo haber salido.
            if (!(err instanceof WhatsAppApiError)) throw err;
            if (err.code === WA_ERROR_CODE.TEMPLATE_NOT_FOUND) {
              opts.pendingTemplates?.add(plan.buttonsTemplate.tpl.name);
            }
          }
        }
        if (!sent) {
          if (opts.pendingTemplates?.has(plan.template.tpl.name)) {
            return await waitForTemplate(plan.template.tpl.name);
          }
          try {
            sent = await sendTemplate(creds, row.phone, plan.template.tpl, plan.template.params);
          } catch (err) {
            if (err instanceof WhatsAppApiError && err.code === WA_ERROR_CODE.TEMPLATE_NOT_FOUND) {
              return await waitForTemplate(plan.template.tpl.name);
            }
            throw err;
          }
        }
        wamid = sent.wamid;
      } else {
        // Un TEXTO que alguien encoló (hoy: el aviso «no pudimos tomar tu
        // solicitud» que encola booking.ts al rechazar) y la ventana de 24 h
        // se cerró antes de que le tocara salir. Mandarlo sería un rechazo
        // seguro de Meta y no hay plantilla para esto: caduca, con la misma
        // marca que lo demás que ya no tiene sentido mandar. No es un fallo
        // de la conexión y la pantalla no lo enseña como tal.
        const expired = "se cerró la ventana de 24 h antes de poder enviarse";
        await prisma.barberMessage
          .update({
            where: { id: row.id },
            data: { status: "FAILED", errorMessage: `${BARBER_REMINDER_INVALIDATED_MARK} ${expired}` },
          })
          .catch(() => {});
        return { outcome: "stale", error: expired };
      }
    } catch (err) {
      const message =
        err instanceof WhatsAppApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "No se pudo enviar";
      await prisma.barberMessage
        .update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
      return { outcome: "failed", error: message };
    }

    // El mensaje YA salió. Si esta escritura fallara, el reclamo viejo lo
    // dejaría como "no se pudo confirmar" en vez de mandarlo otra vez.
    await prisma.barberMessage
      .update({
        where: { id: row.id },
        data: { status: "SENT", waMessageId: wamid, errorMessage: null },
      })
      .catch((e) => console.error(`[barber/wa] enviado pero no marcado (${row.id}):`, e));
    await consumeQuota(shop);
    return { outcome: "sent", error: null };
  } catch (err) {
    console.error(`[barber/wa] fila ${row.id} no procesada:`, err);
    return { outcome: "failed", error: err instanceof Error ? err.message : "No se pudo enviar" };
  }
}

/** Mensajes que caben todavía en el periodo (Infinity = plan ilimitado). */
function quotaRoom(quota: BarberWaQuotaDTO): number {
  return quota.limit < 0 ? Number.POSITIVE_INFINITY : Math.max(0, quota.limit - quota.used);
}

/**
 * Drena la cola de UNA barbería. Devuelve cuántas salieron y cuántas
 * fallaron. Nunca lanza: un mensaje que revienta no puede llevarse por
 * delante los demás.
 *
 * `deadline` (epoch ms) corta la pasada antes de que la función se quede sin
 * tiempo: lo que no alcanzó sigue PENDING y lo toma la siguiente.
 */
export async function drainBarberOutbox(
  barbershopId: string,
  opts: { deadline?: number } = {},
): Promise<{ sent: number; failed: number; skipped: number }> {
  const shop = await loadShop(barbershopId);
  if (!shop || !shop.isActive) return { sent: 0, failed: 0, skipped: 0 };

  const creds = resolveSenderCredentials(shop);
  if (!creds) return { sent: 0, failed: 0, skipped: 0 };

  const rows = (await prisma.barberMessage.findMany({
    where: { barbershopId, direction: "OUTBOUND", status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: DRAIN_LIMIT,
    select: OUTBOX_ROW_SELECT,
  })) as OutboxRow[];
  if (rows.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  // El cupo se lee UNA vez y se va descontando aquí: una consulta por fila
  // era lo que más tiempo se comía de la pasada.
  let room = quotaRoom(await getBarberWaQuota(barbershopId));

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const pendingTemplates = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    if (opts.deadline && Date.now() >= opts.deadline) {
      skipped += rows.length - i;
      break;
    }
    const row = rows[i];
    // Recordatorio que T1 invalidó al mover/cancelar la cita: NUNCA sale.
    // (No debería estar PENDING —T1 lo pasa a FAILED— pero el contrato dice
    // "no tomes nada con esta marca" y aquí se cumple al pie de la letra.)
    if (isInvalidatedReminder(row.errorMessage)) {
      skipped++;
      continue;
    }

    const { outcome } = await processOutboxRow(shop, creds, row, {
      hasQuota: room > 0,
      pendingTemplates,
    });
    if (outcome === "sent") {
      sent++;
      room--;
    } else if (outcome === "failed" || outcome === "lost") {
      failed++;
    } else {
      skipped++;
    }
  }

  return { sent, failed, skipped };
}

export interface DeliverNowResult {
  /** SENT = Meta lo aceptó. FAILED = no salió. PENDING = sigue en la cola. */
  status: "SENT" | "FAILED" | "PENDING";
  /** Por qué no salió (texto para la pantalla), o null si salió. */
  error: string | null;
  code:
    | "NOT_CONNECTED"
    | "QUOTA"
    | "STALE"
    | "BUSY"
    | "NOT_FOUND"
    | "TEMPLATE_PENDING"
    | "SEND_FAILED"
    | null;
}

/**
 * Manda AHORA una fila que acaba de encolarse (el aviso "casi es tu turno"
 * de la fila virtual). Es el MISMO camino que el drenado —reclamo, ventana
 * de 24 h o plantilla, cupo, estados— acotado a una fila: quien toca
 * "Avisar" no puede esperar al siguiente cron.
 *
 * Nunca lanza. Si no hay número conectado o no hay cupo, la fila NO se
 * queda en la cola a propósito: un "ya casi es tu turno" que sale una hora
 * tarde es peor que uno que no sale.
 */
export async function deliverBarberMessageNow(
  barbershopId: string,
  messageId: string,
): Promise<DeliverNowResult> {
  const fail = async (
    code: NonNullable<DeliverNowResult["code"]>,
    error: string,
  ): Promise<DeliverNowResult> => {
    await prisma.barberMessage
      .updateMany({
        where: { id: messageId, barbershopId, status: "PENDING", errorMessage: null },
        data: { status: "FAILED", errorMessage: error },
      })
      .catch(() => {});
    return { status: "FAILED", error, code };
  };

  try {
    const shop = await loadShop(barbershopId);
    if (!shop || !shop.isActive) return await fail("NOT_CONNECTED", "La barbería no está activa.");
    const creds = resolveSenderCredentials(shop);
    if (!creds) {
      return await fail(
        "NOT_CONNECTED",
        "Conecta el WhatsApp de la barbería para poder mandar avisos.",
      );
    }

    const row = (await prisma.barberMessage.findFirst({
      where: { id: messageId, barbershopId, direction: "OUTBOUND", status: "PENDING" },
      select: OUTBOX_ROW_SELECT,
    })) as OutboxRow | null;
    if (!row) return { status: "FAILED", error: "Ese aviso ya no está en la cola.", code: "NOT_FOUND" };

    const room = quotaRoom(await getBarberWaQuota(barbershopId));
    if (room <= 0) {
      return await fail("QUOTA", "Se acabaron los mensajes incluidos de este periodo.");
    }

    const { outcome, error } = await processOutboxRow(shop, creds, row, { hasQuota: true });
    if (outcome === "sent") return { status: "SENT", error: null, code: null };
    if (outcome === "busy") return { status: "PENDING", error: null, code: "BUSY" };
    // Aquí NO se espera a que Meta apruebe la plantilla: quien tocó "Avisar"
    // tiene a la persona enfrente y necesita saberlo ya.
    if (outcome === "waiting") return await fail("TEMPLATE_PENDING", TEMPLATE_PENDING_MESSAGE);
    if (outcome === "stale") return { status: "FAILED", error: `El aviso ya no se mandó: ${error}.`, code: "STALE" };
    return { status: "FAILED", error: error ?? "No se pudo enviar el aviso.", code: "SEND_FAILED" };
  } catch (err) {
    console.error(`[barber/wa] aviso ${messageId} no enviado:`, err);
    return { status: "FAILED", error: "No se pudo enviar el aviso.", code: "SEND_FAILED" };
  }
}

/* ─────────────────── aviso de la fila: "casi es tu turno" ────────────── */

/** No se le avisa dos veces al mismo número en menos de esto. */
export const WALKIN_NOTIFY_DEDUPE_MS = 10 * 60 * 1000;

export interface WalkInNotifyResult {
  /**
   * sent    = Meta lo aceptó;
   * already = ya se le había avisado hace unos minutos (no se repite);
   * queued  = quedó en la cola (otra pasada lo está mandando);
   * failed  = no salió, con el motivo en `error`.
   */
  outcome: "sent" | "already" | "queued" | "failed";
  messageId: string | null;
  error: string | null;
  code: DeliverNowResult["code"] | "NO_PHONE";
}

/**
 * Le avisa por WhatsApp a quien espera en la fila virtual que ya casi le
 * toca. Lo llama POST /api/barber/walkins/[id]/notify, que antes solo
 * dejaba una fila PENDING que nadie mandaba.
 *
 * El envío es el del drenado (deliverBarberMessageNow): texto si el cliente
 * escribió en las últimas 24 h, y si no la plantilla de utilidad
 * `dc_barber_turno_fila`; con reclamo, cupo y estados de entrega.
 *
 * SIN número conectado NO se encola nada: un "ya casi es tu turno" que sale
 * cuando la barbería conecte su WhatsApp, días después, es peor que no
 * mandarlo. Se devuelve el motivo para que el mostrador lo vea.
 */
export async function notifyBarberWalkIn(args: {
  barbershopId: string;
  phone: string;
  /** El aviso ya redactado por walkInNotifyBody() (agenda.ts). */
  body: string;
}): Promise<WalkInNotifyResult> {
  const phone = mxTenDigits(args.phone);
  if (!phone) {
    return {
      outcome: "failed",
      messageId: null,
      error: "Esa persona no dejó un WhatsApp a 10 dígitos.",
      code: "NO_PHONE",
    };
  }
  const shop = await loadShop(args.barbershopId);
  if (!shop || !shop.isActive || !resolveSenderCredentials(shop)) {
    return {
      outcome: "failed",
      messageId: null,
      error: "Conecta el WhatsApp de la barbería para poder mandar avisos.",
      code: "NOT_CONNECTED",
    };
  }

  const client = await prisma.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId: shop.id, phone } },
    select: { id: true },
  });

  // "¿Ya se le avisó?" + "encólalo" con candado por (barbería, teléfono): un
  // doble clic en "Avisar" no puede mandarle dos mensajes seguidos.
  const [lockA, lockB] = advisoryLockKey(`barber:wa:walkin:${shop.id}:${phone}`);
  const row = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`,
      );
      const already = await tx.barberMessage.findFirst({
        where: {
          barbershopId: shop.id,
          phone,
          templateName: BARBER_WALKIN_NOTIFY_TEMPLATE,
          // El MISMO aviso: un doble clic repite el texto palabra por palabra.
          // Un aviso distinto («faltan 2» y, a los 6 minutos, «ya es tu
          // turno») es legítimo y antes se quedaba sin salir.
          body: args.body,
          // Cuenta lo que ya salió, no solo lo que sigue en cola: ahora el
          // aviso se manda en el momento y casi nunca queda PENDING.
          status: { in: ["PENDING", "SENT", "DELIVERED", "READ"] },
          createdAt: { gt: new Date(Date.now() - WALKIN_NOTIFY_DEDUPE_MS) },
        },
        select: { id: true },
      });
      if (already) return { already: true, id: already.id };
      const created = await tx.barberMessage.create({
        data: {
          barbershopId: shop.id,
          direction: "OUTBOUND",
          phone,
          body: args.body,
          templateName: BARBER_WALKIN_NOTIFY_TEMPLATE,
          status: "PENDING",
          clientId: client?.id ?? null,
        },
        select: { id: true },
      });
      return { already: false, id: created.id };
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
  if (row.already) return { outcome: "already", messageId: row.id, error: null, code: null };

  const sent = await deliverBarberMessageNow(shop.id, row.id);
  if (sent.status === "SENT") return { outcome: "sent", messageId: row.id, error: null, code: null };
  if (sent.status === "PENDING") return { outcome: "queued", messageId: row.id, error: null, code: sent.code };
  return { outcome: "failed", messageId: row.id, error: sent.error, code: sent.code };
}

/* ─────────────── aviso al DUEÑO: «pedido nuevo en tu tienda» ─────────── */

export interface OwnerOrderWaResult {
  /**
   * sent    = Meta lo aceptó;
   * skipped = no tocaba mandarlo (interruptor apagado, sin número, sin
   *           WhatsApp conectado, plantilla sin aprobar, sin cupo…): `reason`
   *           dice cuál. No es un fallo;
   * queued  = quedó en la cola (otra pasada lo está mandando);
   * failed  = se intentó y no salió.
   */
  outcome: "sent" | "skipped" | "queued" | "failed";
  reason: string | null;
  messageId: string | null;
}

/**
 * Le avisa por WhatsApp al DUEÑO que entró un pedido a su tienda (ws6-t6,
 * 16-nov-2026). Sale del número de ESTA barbería al WhatsApp que el dueño
 * escribió en Configuración → Notificaciones.
 *
 * Las reglas (decideOwnerWa, pedido-avisos-wa-core.ts) y por qué:
 *   · solo con el interruptor encendido —nace APAGADO: fuera de la ventana de
 *     24 h Meta le cobra cada plantilla a la barbería— y con un número;
 *   · solo si la barbería tiene SU WhatsApp conectado y cupo en su plan;
 *   · si el dueño le escribió a ese número en las últimas 24 h, va como TEXTO
 *     (gratis); si no, con la plantilla `dc_barber_pedido_nuevo_dueno` y SOLO
 *     si Meta ya la aprobó. Si no lo está, no se manda nada (el correo basta)
 *     y NO se queda en cola esperando la aprobación.
 *
 * El envío es el del drenado (deliverBarberMessageNow): reclamo, cupo y
 * estados de entrega. Quien llama (pedido-avisos.ts) ya garantizó «una sola
 * vez por pedido». NUNCA lanza.
 */
export async function notifyBarberOwnerOrder(args: {
  barbershopId: string;
  kind: OrderNoticeKind;
  /** Interruptor «Avisarme por WhatsApp» de la sede. */
  enabled: boolean;
  /** WhatsApp del dueño tal como está guardado. */
  ownerPhone: string | null;
  /** [folio, total, forma de pago], en el orden de la plantilla. */
  params: readonly string[];
}): Promise<OwnerOrderWaResult> {
  const skipped = (d: OwnerWaDecision): OwnerOrderWaResult => ({
    outcome: "skipped",
    reason: d.reason ?? null,
    messageId: null,
  });
  try {
    const ownerPhone = cleanNoticePhone(args.ownerPhone);
    const facts = {
      enabled: args.enabled,
      kind: args.kind,
      ownerPhone,
      connected: true,
      shopPhone: null as string | null,
      hasQuota: true,
      windowOpen: false,
      templateStatus: "APPROVED" as string | null,
    };
    // Lo que se sabe sin tocar la base ni a Meta: apagado, otro motivo, sin número.
    let decision = decideOwnerWa(facts);
    if (decision.send === null) return skipped(decision);

    const shop = await loadShop(args.barbershopId);
    const creds = shop && shop.isActive ? resolveSenderCredentials(shop) : null;
    facts.connected = !!creds;
    facts.shopPhone = mxTenDigits(shop?.phone ?? null);
    decision = decideOwnerWa(facts);
    if (decision.send === null || !shop || !creds || !ownerPhone) return skipped(decision);

    facts.hasQuota = quotaRoom(await getBarberWaQuota(shop.id)) > 0;
    facts.windowOpen = barberWaWindowOpen(await lastInboundAt(shop.id, ownerPhone));
    const tpl = barberWaTemplate("ownerOrder");
    facts.templateStatus = null;
    if (facts.hasQuota && !facts.windowOpen && creds.wabaId) {
      // Fuera de la ventana solo sirve la plantilla, y solo si Meta ya la
      // aprobó: se pregunta por ESA plantilla (una llamada corta, sin costo).
      try {
        const found = pickBarberTemplateRow(await fetchBarberTemplateRows(creds, { name: tpl.name }), tpl.name, tpl.lang);
        facts.templateStatus = found ? (found.otherLanguage ? "OTHER_LANGUAGE" : found.status) : "MISSING";
      } catch {
        facts.templateStatus = null; // no se pudo leer: se trata como «no aprobada»
      }
    }
    decision = decideOwnerWa(facts);
    if (decision.send === null) return skipped(decision);

    const messageId = await enqueueBarberMessage({
      barbershopId: shop.id,
      phone: ownerPhone,
      body: renderOwnerOrderWaText(args.params),
      templateName: tpl.name,
    });
    if (!messageId) return { outcome: "skipped", reason: "noPhone", messageId: null };

    const sent = await deliverBarberMessageNow(shop.id, messageId);
    if (sent.status === "SENT") return { outcome: "sent", reason: null, messageId };
    if (sent.status === "PENDING") return { outcome: "queued", reason: sent.code, messageId };
    return { outcome: "failed", reason: sent.error ?? sent.code ?? "No se pudo enviar", messageId };
  } catch (err) {
    console.error(`[barber/wa] aviso de pedido al dueño (${args.barbershopId}) no enviado:`, err);
    return { outcome: "failed", reason: "No se pudo enviar el aviso.", messageId: null };
  }
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

/**
 * Nombre de pila para el saludo. Sin nombre devuelve un saludo neutro: las
 * plantillas ya empiezan con "Hola {{1}}" / "¡Listo {{1}}!", así que
 * devolver "Hola" aquí mandaba un "Hola Hola, te recordamos…".
 */
function firstName(name: string | null | undefined): string {
  const clean = String(name ?? "").trim();
  if (!clean) return "👋";
  return clean.split(/\s+/)[0];
}

type ApptForMessage = {
  id: string;
  startAt: Date;
  status: string;
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
    select: { id: true, startAt: true, status: true, clientName: true, ...APPT_MESSAGE_INCLUDE },
  })) as ApptForMessage | null;
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

  // UNA lectura con todo lo que hace falta para redactar: antes era una
  // consulta por cita, y con 200 citas eso solo ya se comía la pasada.
  const appointments = await prisma.barberAppointment.findMany({
    where: {
      barbershopId,
      status: { in: ["PENDING", "CONFIRMED"] },
      startAt: { gte: from, lte: to },
      // 🔴 Una SOLICITUD que la barbería todavía no acepta (reserva en línea
      // pendiente) no se recuerda: recordarle al cliente una cita que quizá
      // le rechacen es decirle que la tiene.
      NOT: { status: "PENDING", source: { in: [...BARBER_REQUEST_SOURCES] as never } },
      // Y no se recuerda una visita recién creada: quien agendó hace diez
      // minutos acaba de recibir su confirmación, y el «te recordamos»
      // pegado a ella eran dos mensajes seguidos (y dos del cupo).
      createdAt: { lte: new Date(now - REMINDER_MIN_AGE_MS) },
    },
    select: {
      id: true,
      startAt: true,
      status: true,
      clientId: true,
      clientName: true,
      clientPhone: true,
      client: { select: { name: true, phone: true } },
      barber: { select: { name: true, nickname: true } },
      services: { select: { service: { select: { name: true } } } },
    },
    orderBy: { startAt: "asc" },
    take: 200,
  });
  if (appointments.length === 0) return { queued: 0 };

  const template = barberWaTemplate("reminder");

  // 🔴 SIN DUPLICADOS AUNQUE EL CRON SE ENCIME. "¿Ya tiene recordatorio?" y
  // "encólalo" van dentro de UNA transacción con candado por barbería: dos
  // pasadas a la vez se serializan en Postgres y la segunda ya ve lo que
  // encoló la primera. Sin esto, las dos leían "no tiene" y al cliente le
  // llegaban dos recordatorios. La transacción es corta (tres sentencias,
  // cero llamadas a Meta), así que el candado se suelta en milisegundos.
  const [lockA, lockB] = advisoryLockKey(`barber:wa:reminders:${barbershopId}`);
  const queued = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`,
      );

      const existing = await tx.barberMessage.findMany({
        where: {
          barbershopId,
          templateName: template.name,
          appointmentId: { in: appointments.map((a) => a.id) },
        },
        select: { appointmentId: true, status: true, errorMessage: true },
      });

      // La decisión es PURA y está probada sin BD (whatsapp-core.ts):
      // reminderAlreadyHandled. Aquí solo se agrupa por cita.
      const byAppointment = new Map<
        string,
        { status: (typeof existing)[number]["status"]; errorMessage: string | null }[]
      >();
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

      const data: Prisma.BarberMessageCreateManyInput[] = [];
      for (const appt of appointments) {
        if (handled.has(appt.id)) continue;
        const phone = mxTenDigits(appt.client?.phone ?? appt.clientPhone ?? "");
        if (!phone) continue;
        data.push({
          barbershopId,
          direction: "OUTBOUND",
          phone,
          // Lo que se ve en la bandeja mientras está en cola. Al enviar se
          // vuelve a redactar leyendo la cita (ver planDelivery).
          body: renderReminderText(reminderParamsFrom(shop, appt as unknown as ApptForMessage)),
          templateName: template.name,
          status: "PENDING",
          clientId: appt.clientId,
          appointmentId: appt.id,
        });
      }
      if (data.length === 0) return 0;
      return (await tx.barberMessage.createMany({ data })).count;
    },
    { maxWait: 10_000, timeout: 20_000 },
  );

  return { queued };
}

/* ─────────────── recordatorio AHORA desde la cita (cita «B») ─────────────── */

/**
 * Si ya salió (o está en cola) un recordatorio de esta cita en las últimas X
 * horas, «Recordatorio ahora» no manda otro: lo dice. DECISIÓN PARA RAFAEL
 * (reporte ws6-t5, cita servidor): una constante.
 */
export const REMIND_NOW_DEDUPE_MS = 6 * 60 * 60 * 1000;

export interface RemindNowResult {
  status: "sent" | "queued" | "skipped";
  /** Por qué no salió (texto para la pantalla), o null si salió. */
  reason: string | null;
  code:
    | "PLAN"
    | "NOT_CONNECTED"
    | "NOT_FOUND"
    | "CLOSED"
    | "REQUEST_PENDING"
    | "PAST"
    | "TOO_EARLY"
    | "NO_PHONE"
    | "ALREADY_QUEUED"
    | "RECENT"
    | "QUOTA"
    | "TEMPLATE_PENDING"
    | "SEND_FAILED"
    | "BUSY"
    | null;
  messageId?: string | null;
}

const skipped = (code: NonNullable<RemindNowResult["code"]>, reason: string): RemindNowResult => ({
  status: "skipped",
  reason,
  code,
});

/**
 * «Mandar recordatorio ahora» desde la cita. El MISMO motor que el automático
 * (scheduleBarberReminders + la cola):
 *   · misma plantilla («reminder») y el mismo texto, recalculado al enviar;
 *   · mismo plan (whatsappReminders), misma conexión, mismo cupo;
 *   · mismo candado por barbería, así que no se encima con el cron;
 *   · misma ventana: solo citas por venir en las próximas 24 h, pendientes o
 *     confirmadas (nunca pasadas ni canceladas; una solicitud en línea sin
 *     aceptar tampoco);
 *   · sin duplicar: si ya hay uno en cola, o salió uno en las últimas
 *     REMIND_NOW_DEDUPE_MS, lo dice y no manda otro. Y como la fila queda en
 *     la cola con la plantilla de recordatorio, el automático ya no manda el
 *     suyo para esa cita.
 *
 * Nunca lanza. Si el envío falla (cupo, plantilla sin aprobar…), la fila se
 * marca como invalidada para que el automático pueda intentarlo después.
 */
export async function sendBarberReminderNow(args: {
  barbershopId: string;
  appointmentId: string;
  now?: Date;
}): Promise<RemindNowResult> {
  try {
    const now = args.now ?? new Date();
    const shop = await loadShop(args.barbershopId);
    if (!shop || !shop.isActive) return skipped("NOT_CONNECTED", "La barbería no está activa.");
    const rootId = rootIdOf(shop);
    const root = rootId === shop.id ? shop : ((await loadShop(rootId)) ?? shop);
    if (!isBarbershopSubscriptionActive(root)) return skipped("PLAN", "La suscripción de la barbería no está activa.");
    const plan = await getBarberPlan(root.plan);
    if (!barberPlanHasFeature(plan, "whatsappReminders")) {
      return skipped("PLAN", "Tu plan no incluye recordatorios por WhatsApp.");
    }
    if (!resolveSenderCredentials(shop)) {
      return skipped("NOT_CONNECTED", "No hay WhatsApp conectado: conéctalo en WhatsApp para mandar recordatorios.");
    }

    const appt = await prisma.barberAppointment.findFirst({
      where: { id: args.appointmentId, barbershopId: shop.id },
      select: {
        id: true,
        startAt: true,
        status: true,
        source: true,
        clientId: true,
        clientName: true,
        clientPhone: true,
        client: { select: { name: true, phone: true } },
        barber: { select: { name: true, nickname: true } },
        services: { select: { service: { select: { name: true } } } },
      },
    });
    if (!appt) return skipped("NOT_FOUND", "Esa visita no existe.");
    if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") {
      return skipped("CLOSED", "Solo se recuerda una visita pendiente o confirmada.");
    }
    if (appt.status === "PENDING" && (BARBER_REQUEST_SOURCES as readonly string[]).includes(appt.source)) {
      return skipped("REQUEST_PENDING", "Es una solicitud sin aceptar: acéptala antes de recordarla.");
    }
    if (appt.startAt.getTime() <= now.getTime()) return skipped("PAST", "Esa visita ya pasó.");
    if (appt.startAt.getTime() > now.getTime() + REMINDER_MAX_LEAD_MS) {
      return skipped("TOO_EARLY", "Falta más de un día: el recordatorio se manda dentro de las 24 h antes de la visita.");
    }
    const phone = mxTenDigits(appt.client?.phone ?? appt.clientPhone ?? "");
    if (!phone) return skipped("NO_PHONE", "Esta visita no tiene un WhatsApp a 10 dígitos.");

    const template = barberWaTemplate("reminder");
    const [lockA, lockB] = advisoryLockKey(`barber:wa:reminders:${shop.id}`);
    const decision = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`);
        const rows = await tx.barberMessage.findMany({
          where: { barbershopId: shop.id, appointmentId: appt.id, templateName: template.name, direction: "OUTBOUND" },
          select: { status: true, errorMessage: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        });
        if (rows.some((r) => r.status === "PENDING")) return { kind: "queued-already" as const, at: null };
        const recent = rows.find(
          (r) =>
            r.status !== "FAILED" &&
            !isInvalidatedReminder(r.errorMessage) &&
            now.getTime() - r.createdAt.getTime() < REMIND_NOW_DEDUPE_MS,
        );
        if (recent) return { kind: "recent" as const, at: recent.createdAt };
        const created = await tx.barberMessage.create({
          data: {
            barbershopId: shop.id,
            direction: "OUTBOUND",
            phone,
            body: renderReminderText(reminderParamsFrom(shop, appt as unknown as ApptForMessage)),
            templateName: template.name,
            status: "PENDING",
            clientId: appt.clientId,
            appointmentId: appt.id,
          },
          select: { id: true },
        });
        return { kind: "created" as const, id: created.id };
      },
      { maxWait: 10_000, timeout: 20_000 },
    );

    if (decision.kind === "queued-already") {
      return skipped("ALREADY_QUEUED", "Ya hay un recordatorio de esta visita en camino.");
    }
    if (decision.kind === "recent") {
      const hora = new Intl.DateTimeFormat("es-MX", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: shop.timezone || "America/Mexico_City",
      }).format(decision.at!);
      return skipped("RECENT", `Ya le salió un recordatorio a las ${hora}; no se manda otro tan pronto.`);
    }

    const sent = await deliverBarberMessageNow(shop.id, decision.id);
    if (sent.status === "SENT") return { status: "sent", reason: null, code: null, messageId: decision.id };
    if (sent.status === "PENDING") return { status: "queued", reason: null, code: "BUSY", messageId: decision.id };
    // No salió: se deja la puerta abierta al automático (fila invalidada).
    await prisma.barberMessage
      .updateMany({
        where: { id: decision.id, barbershopId: shop.id, status: "FAILED" },
        data: { errorMessage: `${BARBER_REMINDER_INVALIDATED_MARK} recordatorio manual que no salió: ${sent.error ?? ""}`.trim() },
      })
      .catch(() => {});
    const code: RemindNowResult["code"] =
      sent.code === "QUOTA" || sent.code === "TEMPLATE_PENDING" || sent.code === "NOT_CONNECTED" ? sent.code : "SEND_FAILED";
    return { status: "skipped", reason: sent.error ?? "No se pudo enviar el recordatorio.", code, messageId: decision.id };
  } catch (err) {
    console.error(`[barber/wa] recordatorio ahora ${args.appointmentId}:`, err);
    return skipped("SEND_FAILED", "No se pudo enviar el recordatorio.");
  }
}

/**
 * Cuánto puede durar una pasada del cron. La ruta declara maxDuration = 300;
 * se corta bastante antes para que la función termine por las buenas y
 * conteste lo que hizo, en vez de morir a media barbería.
 */
export const DISPATCH_BUDGET_MS = 240_000;

/**
 * Una pasada completa para TODAS las barberías conectadas: programa lo que
 * falte y drena la cola. Es lo que llama el cron (y el botón "enviar
 * pendientes" de la pantalla, acotado a una sola barbería).
 *
 * AGUANTA SER LLAMADA CADA POCOS MINUTOS Y ENCIMADA CONSIGO MISMA:
 *   · programar es idempotente (candado + "¿ya tiene recordatorio?");
 *   · cada fila de la cola se reclama antes de mandarse, así que dos
 *     pasadas nunca mandan la misma;
 *   · al agotarse el presupuesto de tiempo la pasada se corta y avisa con
 *     `partial: true`; lo pendiente lo toma la siguiente. Se empieza cada
 *     vez por una barbería distinta para que el corte no deje siempre a las
 *     mismas al final.
 */
export async function runBarberWaDispatch(
  only?: string,
  opts: { budgetMs?: number } = {},
): Promise<{
  shops: number;
  queued: number;
  sent: number;
  failed: number;
  partial: boolean;
}> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? DISPATCH_BUDGET_MS);

  const found = await prisma.barbershop.findMany({
    where: {
      isActive: true,
      phoneNumberId: { not: null },
      whatsappToken: { not: null },
      ...(only ? { id: only } : {}),
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 500,
  });
  const offset = found.length > 1 ? Math.floor(Math.random() * found.length) : 0;
  const shops = [...found.slice(offset), ...found.slice(0, offset)];

  let queued = 0;
  let sent = 0;
  let failed = 0;
  let partial = false;
  for (const shop of shops) {
    if (Date.now() >= deadline) {
      partial = true;
      break;
    }
    try {
      queued += (await scheduleBarberReminders(shop.id)).queued;
      const drained = await drainBarberOutbox(shop.id, { deadline });
      sent += drained.sent;
      failed += drained.failed;
    } catch (e) {
      // Una barbería con un problema no puede dejar sin mensajes a las demás.
      console.error(`[barber/wa] barbería ${shop.id} no despachada:`, e);
    }
  }
  return { shops: shops.length, queued, sent, failed, partial };
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
      // Nace RECLAMADA: sale aquí mismo, y el drenado no puede tomarla
      // mientras tanto y mandarla una segunda vez (ver processOutboxRow).
      errorMessage: barberWaClaimMark(),
    },
    select: { id: true },
  });

  try {
    const { wamid } = await sendTemplate(creds, phone, tpl, [args.code]);
    await prisma.barberMessage.update({
      where: { id: row.id },
      data: { status: "SENT", waMessageId: wamid, errorMessage: null },
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
 * Confirmación de reserva: «¡Listo! Tu visita quedó agendada».
 *
 * 🔴 RESPETA LA POLÍTICA DE LA BARBERÍA. Con la política por defecto
 * («manual») la reserva en línea nace como una SOLICITUD pendiente de que la
 * barbería la acepte. Antes esta función encolaba «quedó agendada» igual, y
 * al cliente le llegaba la confirmación de algo que nadie había aceptado (y
 * que podían rechazarle a la mañana siguiente sin avisarle). Ahora:
 *   · solicitud sin aceptar → NO encola nada;
 *   · visita ya firme (política «auto», o solicitud ya aceptada) → encola.
 * Por eso sirve para los DOS momentos sin parámetros de más: al reservar
 * (createPublicBooking ya la llama) y al ACEPTAR en Solicitudes.
 *
 * Va por la cola (sale en la siguiente pasada del despacho). Es idempotente:
 * una visita no se confirma dos veces aunque el flujo reintente. Devuelve el
 * id del mensaje encolado, o null si no se encoló nada.
 */
export async function queueBarberBookingConfirmation(args: {
  barbershopId: string;
  appointmentId: string;
}): Promise<string | null> {
  const shop = await loadShop(args.barbershopId);
  if (!shop || !resolveSenderCredentials(shop)) return null;

  const appt = await prisma.barberAppointment.findFirst({
    where: { id: args.appointmentId, barbershopId: shop.id },
    select: {
      id: true,
      startAt: true,
      status: true,
      source: true,
      clientId: true,
      clientName: true,
      clientPhone: true,
      ...APPT_MESSAGE_INCLUDE,
    },
  });
  if (!appt) return null;
  // Solo se confirma lo que está firme: ni una solicitud sin aceptar, ni una
  // visita cancelada o ya terminada.
  if (isBarberUnacceptedRequest(appt)) return null;
  if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") return null;

  const phone = mxTenDigits(appt.clientPhone ?? "");
  if (!phone) return null;

  const tpl = barberWaTemplate("bookingConfirmed");
  // Idempotencia: una reserva no confirma dos veces aunque el flujo reintente.
  const already = await prisma.barberMessage.findFirst({
    where: { barbershopId: shop.id, appointmentId: appt.id, templateName: tpl.name },
    select: { id: true },
  });
  if (already) return null;

  const params = bookingParamsFrom(shop, appt as unknown as ApptForMessage);
  return enqueueBarberMessage({
    barbershopId: shop.id,
    phone,
    body: renderBookingText(params),
    templateName: tpl.name,
    clientId: appt.clientId,
    appointmentId: appt.id,
  });
}

export interface BookingNoticeResult {
  /** true = el mensaje salió (Meta lo aceptó). */
  sent: boolean;
  /**
   * Por qué no salió, o `sent` / `queued`:
   *   queued        → quedó en la cola; sale en la siguiente pasada del despacho
   *   window_closed → el cliente no ha escrito en 24 h y no hay plantilla para esto
   *   not_connected → la barbería no tiene su WhatsApp conectado
   *   no_phone      → la cita no tiene un celular a 10 dígitos
   *   not_found     → la cita no es de esa barbería
   *   not_applicable→ la cita no está en el estado que corresponde a este aviso
   *   quota         → se acabó el cupo de mensajes del plan
   *   failed        → Meta lo rechazó (el motivo queda en la bandeja)
   */
  reason:
    | "sent"
    | "queued"
    | "window_closed"
    | "not_connected"
    | "no_phone"
    | "not_found"
    | "not_applicable"
    | "quota"
    | "failed";
}

/**
 * LA BARBERÍA ACEPTÓ UNA SOLICITUD → se le confirma al cliente.
 *
 * Para llamarla DESPUÉS de pasar la cita a CONFIRMED (resolveBookingRequest
 * con «aceptar»). Encola «¡Listo! Tu visita quedó agendada» y lo intenta
 * mandar en el momento (texto si el cliente escribió en las últimas 24 h; si
 * no, la plantilla dc_barber_reserva_confirmada). Si no pudo salir ahora
 * mismo (plantilla aún sin aprobar), se queda en la cola y sale sola.
 *
 * NUNCA lanza: aceptar la solicitud no puede fallar por un WhatsApp.
 */
export async function notifyBarberBookingAccepted(args: {
  barbershopId: string;
  appointmentId: string;
}): Promise<BookingNoticeResult> {
  try {
    const shop = await loadShop(args.barbershopId);
    if (!shop || !resolveSenderCredentials(shop)) return { sent: false, reason: "not_connected" };
    const messageId = await queueBarberBookingConfirmation(args);
    if (!messageId) return { sent: false, reason: "not_applicable" };
    const now = await deliverBarberMessageNow(shop.id, messageId);
    if (now.status === "SENT") return { sent: true, reason: "sent" };
    if (now.code === "TEMPLATE_PENDING") {
      // deliverBarberMessageNow no espera a Meta; la confirmación sí puede
      // esperar unos minutos: vuelve a la cola para la siguiente pasada.
      await prisma.barberMessage.updateMany({
        where: { id: messageId, barbershopId: shop.id, status: "FAILED" },
        data: { status: "PENDING", errorMessage: null },
      });
      return { sent: false, reason: "queued" };
    }
    if (now.status === "PENDING") return { sent: false, reason: "queued" };
    return { sent: false, reason: now.code === "QUOTA" ? "quota" : "failed" };
  } catch (err) {
    console.error(`[barber/wa] aviso de solicitud aceptada no enviado (${args.appointmentId}):`, err);
    return { sent: false, reason: "failed" };
  }
}

/**
 * ⛔ SIN USO — NO LA LLAMES. El aviso de rechazo que SÍ sale es
 * `notifyBookingRejected` en src/lib/barber/booking.ts, la que llama
 * resolveBookingRequest al rechazar (encola un texto, solo dentro de la
 * ventana de 24 h). Ésta se escribió en paralelo para lo mismo, con otro
 * texto, y quedó sin llamadores al unir las ramas. Se deja (no se borra) y
 * la siguen ejercitando sus pruebas de whatsapp-integration; llamarla ADEMÁS
 * de la de booking.ts le mandaría al cliente dos avisos de rechazo.
 *
 * @deprecated Usa la de booking.ts (resolveBookingRequest). Ver arriba.
 *
 * LA BARBERÍA RECHAZÓ UNA SOLICITUD → se le avisa al cliente, SI SE PUEDE.
 *
 * Para llamarla DESPUÉS de pasar la cita a CANCELLED (resolveBookingRequest
 * con «rechazar»). Antes no se mandaba nada y el cliente llegaba a la
 * barbería con una cita que ya no existía.
 *
 * Decisión ya tomada: NO hay plantilla de rechazo. Así que:
 *   · el cliente escribió en las últimas 24 h → texto libre, ahora mismo;
 *   · fuera de esa ventana → NO se manda nada (Meta rechazaría el texto) y
 *     se devuelve `window_closed` para que la pantalla le diga a la barbería
 *     que a este cliente hay que llamarle.
 *
 * NUNCA lanza: rechazar la solicitud no puede fallar por un WhatsApp.
 */
export async function notifyBarberBookingRejected(args: {
  barbershopId: string;
  appointmentId: string;
}): Promise<BookingNoticeResult> {
  try {
    const shop = await loadShop(args.barbershopId);
    const creds = shop ? resolveSenderCredentials(shop) : null;
    if (!shop || !creds) return { sent: false, reason: "not_connected" };

    const appt = await prisma.barberAppointment.findFirst({
      where: { id: args.appointmentId, barbershopId: shop.id },
      select: {
        id: true,
        startAt: true,
        status: true,
        clientName: true,
        clientPhone: true,
        client: { select: { name: true, phone: true } },
      },
    });
    if (!appt) return { sent: false, reason: "not_found" };
    // Solo se avisa de un rechazo que YA ocurrió.
    if (appt.status !== "CANCELLED") return { sent: false, reason: "not_applicable" };

    const phone = mxTenDigits(appt.clientPhone ?? appt.client?.phone ?? "");
    if (!phone) return { sent: false, reason: "no_phone" };

    if (!barberWaWindowOpen(await lastInboundAt(shop.id, phone))) {
      return { sent: false, reason: "window_closed" };
    }
    const quota = await getBarberWaQuota(shop.id);
    if (!barberWaFits(quota.limit, quota.used)) return { sent: false, reason: "quota" };

    const sent = await replyInline(
      shop,
      creds,
      phone,
      barberBookingRejectedText({
        clientName: appt.client?.name ?? appt.clientName,
        when: formatWhen(appt.startAt, shop.timezone, shop.locale),
        shopName: shop.name,
      }),
      { appointmentId: appt.id },
    );
    return sent ? { sent: true, reason: "sent" } : { sent: false, reason: "failed" };
  } catch (err) {
    console.error(`[barber/wa] aviso de solicitud rechazada no enviado (${args.appointmentId}):`, err);
    return { sent: false, reason: "failed" };
  }
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
}): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  /**
   * Por qué se CORTÓ la tanda, si se cortó. Quien llama lo necesita para no
   * decirle a la barbería «se acabó el cupo» cuando lo que pasa es que no
   * tiene el número conectado, o que ese cliente simplemente no era elegible.
   */
  stop: "quota" | "not_connected" | null;
}> {
  const ids = args.clientIds.slice(0, CAMPAIGN_BATCH_MAX);
  const shop = await loadShop(args.barbershopId);
  const creds = shop ? resolveSenderCredentials(shop) : null;
  if (!shop || !creds) return { sent: 0, failed: 0, skipped: ids.length, stop: "not_connected" };

  const tpl = barberWaTemplate(args.kind);
  const clients = await prisma.barberClient.findMany({
    where: { barbershopId: shop.id, id: { in: ids }, blockedAt: null },
    select: { id: true, name: true, phone: true, preferences: true },
  });

  const promo = sanitizeBarberWaParam(args.promo, "").slice(0, 300) || "Te esperamos cuando gustes.";
  let sent = 0;
  let failed = 0;
  let stop: "quota" | null = null;

  for (const client of clients) {
    const phone = mxTenDigits(client.phone);
    if (!phone) continue;
    // 🔴 LA BAJA SE RESPETA AQUÍ, EN EL EMISOR. La pantalla nueva de campañas
    // ya filtra a los que pidieron no recibir promociones, pero la de
    // WhatsApp → Campañas manda los ids que le llegan: sin esta línea, a un
    // cliente dado de baja le seguía llegando la felicitación.
    if (barberClientOptedOut(client.preferences)) continue;

    const quota = await getBarberWaQuota(shop.id);
    if (!barberWaFits(quota.limit, quota.used)) {
      stop = "quota";
      break;
    }

    const params = [firstName(client.name), shop.name, promo];
    const row = await prisma.barberMessage.create({
      data: {
        barbershopId: shop.id,
        direction: "OUTBOUND",
        phone,
        body: renderCampaignText(args.kind, params),
        templateName: tpl.name,
        status: "PENDING",
        errorMessage: barberWaClaimMark(),
        clientId: client.id,
      },
      select: { id: true },
    });

    try {
      const { wamid } = await sendTemplate(creds, phone, tpl, params);
      await prisma.barberMessage.update({
        where: { id: row.id },
        data: { status: "SENT", waMessageId: wamid, errorMessage: null },
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

  return { sent, failed, skipped: ids.length - sent - failed, stop };
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
  // Todo lo que pase aquí (nota de voz + turno del bot) tiene que caber en
  // el tiempo de la función del webhook compartido (maxDuration = 60 s).
  const deadlineAt = Date.now() + INGEST_BUDGET_MS;

  const shop = await shopByPhoneNumberId(value?.metadata?.phone_number_id);
  if (!shop) return false;

  const from = typeof msg?.from === "string" ? msg.from : "";
  const phone = mxTenDigits(from);
  if (!phone) return true;

  const wamid = typeof msg?.id === "string" && msg.id ? msg.id : null;

  // `let`: una nota de voz transcrita entra más abajo como texto.
  let rawText = String(
    msg?.text?.body ??
      msg?.interactive?.button_reply?.title ??
      msg?.interactive?.list_reply?.title ??
      msg?.button?.text ??
      "",
  ).trim();
  // ¿Tocó un botón o una fila? El id dice de quién era, sin adivinar por el
  // texto: un «Sí, agéndala» del BOT no es un «sí» al recordatorio, y un
  // «❌ Cancelar» del RECORDATORIO dice además de qué visita se trata.
  const tappedId =
    msg?.interactive?.button_reply?.id ?? msg?.interactive?.list_reply?.id ?? msg?.button?.payload;
  const tappedBotOption = isBarberBotOptionId(tappedId);
  const reminderTap = parseBarberReminderButton(tappedId);
  // 🔴 Lo que viene de una nota de voz NUNCA decide sobre un recordatorio.
  let fromVoice = false;
  const incoming = rawText ? null : describeBarberIncoming(msg);
  if (!rawText && !incoming) return true;

  // Se LIGA a un cliente existente; jamás se crea uno desde el webhook (un
  // número equivocado no puede dar de alta clientes fantasma).
  const client = await prisma.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId: shop.id, phone } },
    select: { id: true },
  });

  // 🔴 DEDUP POR wamid, DENTRO DE POSTGRES. Meta reintenta el webhook ante
  // timeouts y 5xx, y un turno con nota de voz puede tardar lo suficiente
  // para que el reintento llegue mientras el primero sigue trabajando.
  // `waMessageId` no tiene índice único (y el schema no se toca), así que
  // "¿ya lo tengo?" + "guárdalo" van en una transacción con candado por
  // wamid: el segundo espera, ve la fila del primero y se va. Sin esto el
  // bot contestaba dos veces el mismo mensaje.
  const stored = await prisma.$transaction(
    async (tx) => {
      if (wamid) {
        const [lockA, lockB] = advisoryLockKey(`barber:wa:in:${wamid}`);
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`,
        );
        const duplicate = await tx.barberMessage.findFirst({
          where: { barbershopId: shop.id, waMessageId: wamid, direction: "INBOUND" },
          select: { id: true },
        });
        if (duplicate) return null;
      }
      return tx.barberMessage.create({
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
        select: { id: true },
      });
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
  if (!stored) return true;

  // Palomitas azules en el teléfono del cliente. Best-effort: una palomita
  // nunca puede tumbar la ingesta.
  const creds = resolveSenderCredentials(shop);
  if (creds && wamid) {
    void markWhatsAppMessageRead(creds.phoneNumberId, creds.accessToken, wamid).catch(() => {});
  }

  if (incoming) {
    // Multimedia que no es audio: llegó, quedó en el Inbox y AQUÍ TERMINA.
    // Una foto no es un "CONFIRMAR" y no puede tocar la agenda de nadie.
    if (msg?.type !== "audio") return true;

    // NOTA DE VOZ: si el bot está atendiendo este hilo se transcribe y sigue
    // el camino de un mensaje escrito (el Inbox ya dice «🎤 Nota de voz: …»
    // y conserva el audio). Si no se pudo escuchar, se le pide que lo
    // escriba. Si no toca transcribir (bot apagado o en pausa, sin tope de
    // IA…), el audio se queda en la bandeja para el equipo, como antes.
    const voz = await understandBarberVoice(shop, creds, phone, msg.audio, stored.id);
    if (voz.accion === "avisar") {
      await replyInline(
        shop,
        creds,
        phone,
        voz.motivo === "largo" ? BARBER_WA_VOICE_TOO_LONG_REPLY : BARBER_WA_VOICE_FAILED_REPLY,
      );
      return true;
    }
    if (voz.accion === "como_antes") {
      // Fuera del horario del bot no se transcribe (no se gasta), pero el
      // cliente recibe el mismo aviso que si hubiera escrito.
      if (voz.fueraDeHorario) {
        await runBotIfEnabled(shop, creds, phone, incoming.body, { deadlineAt, inboundId: stored.id });
      }
      return true;
    }
    rawText = voz.texto;
    fromVoice = true;
  }

  // "BAJA" / "ya no me manden promociones": se respeta ANTES que nada y no
  // se le consulta a ninguna IA. Solo aplica a quien ya es cliente (sin
  // ficha no hay a quién dar de baja, y el mensaje sigue su camino). Tiene
  // que estar ESCRITO: ni un toque ni lo que un transcriptor creyó oír.
  if (
    !fromVoice &&
    !tappedId &&
    isBarberOptOutText(rawText) &&
    (await optOutByPhone(shop.id, phone))
  ) {
    await replyInline(shop, creds, phone, BARBER_WA_OPT_OUT_REPLY);
    return true;
  }

  // ¿Es una respuesta al recordatorio? Solo hay tres formas de serlo:
  //   · tocó un botón del recordatorio (el id trae la acción y la visita);
  //   · ESCRIBIÓ exactamente CONFIRMAR / CANCELAR / CAMBIAR (o 1/2/3, sí/ok)
  //     y el recordatorio fue lo último que le dijimos;
  //   · contestó sí/no a nuestra pregunta «¿Cancelo tu visita…?».
  // Una frase normal, una nota de voz o un toque en una opción del bot NO
  // pasan por aquí: van al bot o se quedan en la bandeja.
  let handled = false;
  if (reminderTap) {
    handled = await applyReminderAction(shop, creds, phone, reminderTap.action, {
      appointmentId: reminderTap.appointmentId,
      tapped: true,
    });
  } else if (!tappedBotOption && !fromVoice) {
    handled = await applyReminderReply(shop, creds, phone, rawText);
  }

  // El BOT es el último en la fila, a propósito: primero manda lo que el
  // cliente respondió a un recordatorio nuestro (eso ya tiene dueño y no
  // se le consulta a ninguna IA). Solo lo que nadie atendió llega al bot.
  let botAttended = false;
  if (!handled) {
    botAttended = await runBotIfEnabled(shop, creds, phone, rawText, { deadlineAt, inboundId: stored.id });
  }

  // ACUSE AUTOMÁTICO (opcional, apagado por defecto): una frase escrita en
  // respuesta al recordatorio que NADIE atendió recibe «Recibimos tu
  // mensaje…». Las reglas viven en decideBarberWaAck (wa-acuse-core.ts).
  if (!handled && !botAttended && !fromVoice && !tappedId) {
    await maybeSendBarberWaAck(shop, creds, phone, client?.id ?? null);
  }
  return true;
}

/**
 * Cuánto puede durar la ingesta de UN mensaje (nota de voz + bot). El
 * webhook compartido declara maxDuration = 60 s; se deja margen para que
 * conteste 200 por las buenas.
 */
const INGEST_BUDGET_MS = 52_000;
/** Bajar el audio de Meta y transcribirlo, acotados aparte. */
const VOICE_DOWNLOAD_TIMEOUT_MS = 12_000;
const VOICE_TRANSCRIBE_TIMEOUT_MS = 20_000;

type BarberVoiceResult = ResultadoNotaDeVoz & { fueraDeHorario?: boolean };

/**
 * NOTA DE VOZ → texto, con las reglas del dental y el dinero de barber.
 *
 * El flujo (puertas, tope de duración y de tamaño, qué se le dice al cliente
 * cuando no se pudo) es `procesarNotaDeVoz`, el núcleo puro del bot del
 * dental, IMPORTADO tal cual. Aquí solo se le inyecta lo propio de barber:
 *   · "¿el bot está atendiendo?" lo contesta bot.ts (barberBotGate): si el
 *     bot no va a contestar, no se gasta en transcribir;
 *   · el COSTO cuenta contra el tope diario de IA de la barbería
 *     (barber_bot_usage), no contra ningún saldo;
 *   · el audio NO se guarda en ningún lado: entra en memoria, se transcribe
 *     y se descarta. La bandeja lo sigue sirviendo desde Meta por media id.
 *
 * Nunca lanza.
 */
async function understandBarberVoice(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  audio: unknown,
  inMsgId: string,
): Promise<BarberVoiceResult> {
  let gate: { open: boolean; reason: string | null };
  let charge: (barbershopId: string, seconds: number) => Promise<void>;
  try {
    const bot = await import("@/lib/barber/bot");
    gate = await bot.barberBotGate(shop.id, phone);
    charge = bot.chargeBarberBotVoice;
  } catch (err) {
    console.error(`[barber/wa-voz] no se pudo consultar al bot (${shop.id}):`, err);
    return { accion: "como_antes", motivo: "puerta_fallo" };
  }

  // Motivos por los que el bot no atendería NI un mensaje escrito.
  const botOff = ["disabled", "planLocked", "subscriptionInactive", "storageMissing", "offHours", "notConnected", "error"];
  // Motivos por los que sí atendería, pero no hay con qué pagar la IA.
  const noBudget = ["aiCapReached", "aiUnavailable", "quotaExhausted"];

  const deps: DepsNotaDeVoz = {
    botEncendido: async () => !botOff.includes(gate.reason ?? ""),
    // En barber no hay un interruptor aparte para el dictado.
    dictadoApagado: async () => false,
    sinCupo: async () => noBudget.includes(gate.reason ?? ""),
    // Anti-abuso: no más de VOZ_POR_REMITENTE audios transcritos por número
    // en la ventana. Se cuenta sobre la propia bandeja (los ya transcritos
    // quedaron con su prefijo), sin tabla nueva.
    permitirRemitente: async () => {
      const recent = await prisma.barberMessage.count({
        where: {
          barbershopId: shop.id,
          phone,
          direction: "INBOUND",
          createdAt: { gt: new Date(Date.now() - VENTANA_VOZ_SEG * 1000) },
          OR: BARBER_WA_VOICE_BODY_PREFIXES.map((prefix) => ({ body: { startsWith: prefix } })),
        },
      });
      return recent < VOZ_POR_REMITENTE;
    },
    transcriptorConfigurado: () => Boolean(process.env.OPENAI_API_KEY),
    metaDelAudio: (accessToken, mediaId) => getWhatsAppMediaMeta(accessToken, mediaId),
    descargar: async (accessToken, url, maxBytes) => {
      const res = await fetch(url, {
        // User-Agent explícito: sin él el CDN de Meta a veces devuelve HTML
        // en vez del archivo (mismo detalle que el proxy de multimedia).
        headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "curl/8.4.0" },
        signal: AbortSignal.timeout(VOICE_DOWNLOAD_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`descarga_${res.status}`);
      if ((Number(res.headers.get("content-length")) || 0) > maxBytes) throw new Error("demasiado_grande");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error("demasiado_grande");
      return buf;
    },
    transcribir: async ({ audio: bytes, filename, mime }) => {
      // import() perezoso: el transcriptor es `server-only`.
      const { transcribeAudio } = await import("@/lib/integrations/whisper");
      return transcribeAudio({
        audio: bytes,
        filename,
        mime,
        prompt: BARBER_WA_VOICE_HINT,
        signal: AbortSignal.timeout(VOICE_TRANSCRIBE_TIMEOUT_MS),
      });
    },
    cobrar: (barbershopId, segundos) => charge(barbershopId, segundos),
    reescribirEntrada: async (barbershopId, messageId, body) => {
      await prisma.barberMessage.updateMany({ where: { id: messageId, barbershopId }, data: { body } });
    },
    // Nunca el texto ni el audio: solo qué pasó.
    log: (evento, datos) => console.info(`[barber/wa-voz] ${evento}`, datos),
  };

  const result = await procesarNotaDeVoz(
    {
      // El núcleo es del dental y llama `clinicId` al inquilino: aquí es la
      // barbería. Solo viaja de vuelta a las dependencias de arriba.
      clinicId: shop.id,
      threadId: phone,
      inMsgId,
      from: phone,
      audio: audio && typeof audio === "object" ? (audio as Record<string, unknown>) : null,
      botActive: gate.reason === "paused" ? false : true,
      accessToken: creds?.accessToken ?? null,
    },
    deps,
  );
  return result.accion === "como_antes"
    ? { ...result, fueraDeHorario: gate.reason === "offHours" }
    : result;
}

/** Cada cuánto vuelve a mirar un mensaje que espera su turno. */
const TURN_POLL_MS = 350;
/** Un turno necesita al menos esto para valer la pena; con menos, no se toma. */
const TURN_MIN_ROOM_MS = 10_000;

/** Los entrantes de la conversación que llevan una marca de turno. */
function turnRowsWhere(barbershopId: string, phone: string) {
  return {
    barbershopId,
    phone,
    direction: "INBOUND" as const,
    errorMessage: { startsWith: BARBER_WA_TURN_PREFIX },
  };
}

/**
 * Toma (o cede) el turno del bot para UN mensaje entrante.
 *
 * La decisión se toma dentro de un candado de Postgres por (barbería,
 * teléfono) que dura milisegundos — leer las marcas y escribir la propia—,
 * así que dos mensajes del mismo cliente nunca deciden a la vez. El turno en
 * sí NO corre dentro de esa transacción: lo que lo protege durante los
 * segundos que tarda es la marca «atendiendo».
 *
 * Devuelve `run` con `seenUpTo` (la hora del entrante más nuevo que este
 * turno va a ver: reloj de la base, no del servidor), o `skip` si otro turno
 * contesta por éste o si ya no queda tiempo.
 */
async function claimBotTurn(
  barbershopId: string,
  phone: string,
  inboundId: string,
  deadlineAt: number,
): Promise<{ decision: "run"; seenUpTo: Date } | { decision: "skip" }> {
  const [lockA, lockB] = advisoryLockKey(`barber:wa:turn:${barbershopId}:${phone}`);
  const waitUntil = new Date(deadlineAt - TURN_MIN_ROOM_MS);

  for (;;) {
    const now = new Date();
    const outOfTime = now.getTime() >= waitUntil.getTime();
    const step = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`,
        );
        const me = await tx.barberMessage.findFirst({
          where: { id: inboundId, barbershopId },
          select: { id: true, createdAt: true },
        });
        if (!me) return { decision: "yield" as const, seenUpTo: null };
        const others = await tx.barberMessage.findMany({
          where: { ...turnRowsWhere(barbershopId, phone), id: { not: me.id } },
          select: { id: true, createdAt: true, errorMessage: true },
        });
        let decision = decideBarberBotTurn(me, others, now);
        if (decision === "wait" && outOfTime) decision = "yield";

        let seenUpTo: Date | null = null;
        if (decision === "run") {
          const newest = await tx.barberMessage.findFirst({
            where: { barbershopId, phone, direction: "INBOUND" },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          seenUpTo = newest?.createdAt ?? me.createdAt;
        }
        await tx.barberMessage.update({
          where: { id: me.id },
          data: {
            errorMessage:
              decision === "run"
                ? barberBotTurnMark("atendiendo", new Date(deadlineAt))
                : decision === "wait"
                  ? barberBotTurnMark("espera", waitUntil)
                  : null,
          },
        });
        return { decision, seenUpTo };
      },
      { maxWait: 10_000, timeout: 15_000 },
    );

    if (step.decision === "run" && step.seenUpTo) return { decision: "run", seenUpTo: step.seenUpTo };
    if (step.decision !== "wait") return { decision: "skip" };
    await new Promise((resolve) => setTimeout(resolve, TURN_POLL_MS));
  }
}

/**
 * Suelta el turno. Si contestó (`seenUpTo`), deja la marca «listo» con la
 * hora hasta la que vio —es lo que hace ceder a los mensajes anteriores que
 * seguían esperando— y borra los «listo» viejos de la conversación (queda
 * como mucho uno). Si NO contestó (su respuesta nació vieja), solo se quita.
 */
async function releaseBotTurn(
  barbershopId: string,
  phone: string,
  inboundId: string,
  seenUpTo: Date | null,
): Promise<void> {
  try {
    if (seenUpTo) {
      await prisma.barberMessage.updateMany({
        where: {
          ...turnRowsWhere(barbershopId, phone),
          id: { not: inboundId },
          errorMessage: { startsWith: `${BARBER_WA_TURN_PREFIX}listo]` },
        },
        data: { errorMessage: null },
      });
    }
    await prisma.barberMessage.updateMany({
      where: { id: inboundId, barbershopId },
      data: { errorMessage: seenUpTo ? barberBotTurnMark("listo", seenUpTo) : null },
    });
  } catch (err) {
    // La marca «atendiendo» caduca sola con su hora: no puede dejar mudo el hilo.
    console.error(`[barber/wa] no se pudo soltar el turno del bot (${barbershopId}):`, err);
  }
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
 *
 * 🔴 UN TURNO POR CONVERSACIÓN (G4). Antes de correr se toma el turno de ese
 * (barbería, teléfono): si otro mensaje del mismo cliente se está
 * atendiendo, éste espera; si hay uno más nuevo esperando, cede. Y antes de
 * MANDAR la respuesta se mira si llegó algo que este turno no alcanzó a ver:
 * entonces la respuesta ya nació vieja y no sale — el turno del mensaje
 * nuevo contesta por todos. Tres mensajes seguidos = una respuesta. Como los
 * turnos van uno tras otro, cada uno lee el gasto de IA que dejó el anterior
 * y una ráfaga ya no puede rebasar el tope diario.
 */
async function runBotIfEnabled(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  text: string,
  opts: { deadlineAt: number; inboundId: string },
): Promise<boolean> {
  // Devuelve true si el BOT atendió este mensaje (contestó, o lo contesta
  // otro turno suyo). false = nadie del bot lo atendió: apagado, pausado sin
  // respuesta, o falló. Lo usa el acuse automático para no hablar encima.
  let seenUpTo: Date | null = null;
  let claimed = false;
  let answered = false;
  try {
    const { runBarberBotTurn, barberBotIsOn } = await import("@/lib/barber/bot");
    // Con el bot apagado no hay turno que ordenar: ni candado ni marcas (la
    // enorme mayoría de los mensajes de una barbería sin bot pasan por aquí).
    if (!(await barberBotIsOn(shop.id))) return false;

    const claim = await claimBotTurn(shop.id, phone, opts.inboundId, opts.deadlineAt);
    // Otro turno del bot contesta por éste (o ya no da tiempo): el bot lo tiene.
    if (claim.decision !== "run") return true;
    claimed = true;
    seenUpTo = claim.seenUpTo;

    const turn = await runBarberBotTurn({
      barbershopId: shop.id,
      phone,
      text,
      // Se le deja un margen para mandar la respuesta después del turno.
      deadlineAt: opts.deadlineAt - 4000,
      // Tomó el turno y ningún turno anterior vio este mensaje: hay que atenderlo
      // aunque la respuesta a lo anterior haya quedado guardada después.
      unanswered: true,
    });
    answered = true;
    if (!turn.reply) return false;

    // Lo que el turno YA HIZO (agendó, canceló, movió, pasó con una persona)
    // o un aviso fijo (fuera de horario, tope) se dice siempre. Solo una
    // respuesta de pura conversación puede "nacer vieja".
    const hizoAlgo =
      turn.skipped !== null ||
      turn.effects.handoff ||
      turn.effects.booked.length > 0 ||
      turn.effects.cancelled.length > 0 ||
      turn.effects.rescheduled.length > 0;
    if (!hizoAlgo) {
      const others = await prisma.barberMessage.findMany({
        where: { ...turnRowsWhere(shop.id, phone), id: { not: opts.inboundId } },
        select: { id: true, createdAt: true, errorMessage: true },
      });
      if (barberBotReplyIsStale(seenUpTo, others, new Date())) {
        // La respuesta nació vieja: el turno del mensaje más nuevo contesta
        // por todos. El bot lo tiene.
        answered = false;
        return true;
      }
    }
    await replyInline(shop, creds, phone, turn.reply, { options: turn.options });
    return true;
  } catch (err) {
    console.error(`[barber/wa] el bot no pudo atender (${shop.id}):`, err);
    return false;
  } finally {
    if (claimed) await releaseBotTurn(shop.id, phone, opts.inboundId, answered ? seenUpTo : null);
  }
}

/**
 * ACUSE AUTOMÁTICO (opcional): «Recibimos tu mensaje. En un momento te
 * contestamos.» — o el texto que escribió la barbería.
 *
 * Solo se llama con una frase ESCRITA que nadie atendió (ni el recordatorio,
 * ni la baja, ni el bot). Lo demás lo decide decideBarberWaAck: ajuste
 * encendido, que lo último que le dijimos sea el recordatorio (y reciente),
 * que haya cupo y conexión.
 *
 * UNA vez por conversación y por día: «¿ya salió un acuse desde el
 * recordatorio o desde que empezó el día de la barbería?» y «guárdalo» van
 * dentro de una transacción con candado por (barbería, teléfono). Dos
 * mensajes seguidos del cliente no sacan dos acuses.
 *
 * Texto libre: el cliente acaba de escribir, la ventana de 24 h está
 * abierta. Gasta del cupo como cualquier mensaje. Nunca lanza: un acuse que
 * no sale no puede tumbar la ingesta.
 */
async function maybeSendBarberWaAck(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  clientId: string | null,
): Promise<BarberWaAckDecision> {
  try {
    const { settings } = await getBarberWaAck(shop.id);
    // La enorme mayoría de las barberías lo tienen apagado: una sola lectura.
    if (!settings.enabled) return "off";

    const now = new Date();
    const reminder = barberWaTemplate("reminder");
    const last = await lastWordTo(shop.id, phone, reminder.name);
    const quota = await getBarberWaQuota(shop.id);
    const decision = decideBarberWaAck({
      settings,
      connected: !!creds,
      writtenText: true,
      handled: false,
      botAttended: false,
      lastWord: last ? { templateName: last.templateName, createdAt: last.createdAt } : null,
      reminderTemplate: reminder.name,
      alreadyAcked: false,
      quotaFits: barberWaFits(quota.limit, quota.used),
      now,
    });
    if (decision !== "send" || !creds || !last) return decision;

    // «Una vez por conversación y por día»: desde el recordatorio que abrió
    // esta conversación, o desde el inicio del día de la barbería, lo que
    // sea ANTES.
    const dayStart = barberTzLocalToUtc(barberTodayISO(shop.timezone, now), 0, 0, shop.timezone);
    const since = last.createdAt.getTime() < dayStart.getTime() ? last.createdAt : dayStart;
    const body = barberWaAckText(settings);

    const [lockA, lockB] = advisoryLockKey(`barber:wa:acuse:${shop.id}:${phone}`);
    const row = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`,
        );
        const already = await tx.barberMessage.count({
          where: {
            barbershopId: shop.id,
            phone,
            direction: "OUTBOUND",
            templateName: BARBER_WA_ACK_MARK,
            // Uno que Meta rechazó no cuenta: el siguiente mensaje lo reintenta.
            status: { not: "FAILED" },
            createdAt: { gte: since },
          },
        });
        if (already > 0) return null;
        return tx.barberMessage.create({
          data: {
            barbershopId: shop.id,
            direction: "OUTBOUND",
            phone,
            body,
            status: "PENDING",
            // Nace RECLAMADA, como las respuestas en línea: el drenado de la
            // cola no puede mandarla una segunda vez.
            errorMessage: barberWaClaimMark(),
            templateName: BARBER_WA_ACK_MARK,
            clientId,
          },
          select: { id: true },
        });
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
    if (!row) return "alreadyAcked";

    try {
      const { wamid } = await sendText(creds, phone, body);
      await prisma.barberMessage.update({
        where: { id: row.id },
        data: { status: "SENT", waMessageId: wamid, errorMessage: null },
      });
      await consumeQuota(shop);
      return "send";
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo enviar el acuse";
      await prisma.barberMessage
        .update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
      return "notConnected";
    }
  } catch (err) {
    console.error(`[barber/wa] no se pudo resolver el acuse automático (${shop.id}):`, err);
    return "off";
  }
}

/**
 * Da de baja de promociones al cliente de ese teléfono. La escritura es de
 * campaigns.ts (dueño de la llave y de la bitácora); import DINÁMICO porque
 * aquel módulo importa éste. Nunca lanza: false = no se dio de baja a nadie.
 */
async function optOutByPhone(barbershopId: string, phone: string): Promise<boolean> {
  try {
    const { optOutBarberClientByPhone } = await import("@/lib/barber/campaigns");
    return await optOutBarberClientByPhone(barbershopId, phone);
  } catch (err) {
    console.error(`[barber/wa] no se pudo registrar la baja (${barbershopId}):`, err);
    return false;
  }
}

/** Filas salientes que de verdad le llegaron al cliente (ni sistema, ni fallidas, ni en cola). */
function deliveredOutboundWhere(barbershopId: string, phone: string) {
  return {
    barbershopId,
    phone,
    direction: "OUTBOUND" as const,
    status: { in: ["SENT", "DELIVERED", "READ"] as ("SENT" | "DELIVERED" | "READ")[] },
    // OR explícito: en SQL `NOT (NULL LIKE 'sys:%')` es NULL y dejaría
    // fuera justo las filas sin templateName, que son las respuestas.
    // El ACUSE automático tampoco cuenta como «lo último que le dijimos»: un
    // CONFIRMAR escrito después del acuse sigue siendo para el recordatorio.
    OR: [
      { templateName: null },
      {
        AND: [
          { NOT: { templateName: { startsWith: BARBER_WA_SYS_PREFIX } } },
          { NOT: { templateName: BARBER_WA_ACK_MARK } },
        ],
      },
    ],
  };
}

/**
 * Lo ÚLTIMO que le dijimos a este número y, si fueron varios recordatorios
 * seguidos sin nada en medio, de cuántas visitas distintas.
 */
async function lastWordTo(
  barbershopId: string,
  phone: string,
  reminderTemplate: string,
): Promise<{
  templateName: string | null;
  appointmentId: string | null;
  /** Cuándo se le dijo (lo usa el acuse automático). */
  createdAt: Date;
  /** Visitas distintas en la racha de recordatorios que cierra el hilo. */
  reminderStreak: string[];
} | null> {
  const rows = await prisma.barberMessage.findMany({
    where: deliveredOutboundWhere(barbershopId, phone),
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { templateName: true, appointmentId: true, createdAt: true },
  });
  if (rows.length === 0) return null;
  const streak: string[] = [];
  for (const row of rows) {
    if (row.templateName !== reminderTemplate) break;
    if (row.appointmentId && !streak.includes(row.appointmentId)) streak.push(row.appointmentId);
  }
  return {
    templateName: rows[0].templateName,
    appointmentId: rows[0].appointmentId,
    createdAt: rows[0].createdAt,
    reminderStreak: streak,
  };
}

/**
 * Una respuesta ESCRITA: ¿es para el recordatorio (o para nuestra pregunta
 * «¿Cancelo tu visita…?»)? La decisión es pura y está probada sin base
 * (decideBarberReminderReply, whatsapp-core.ts); aquí solo se lee qué fue lo
 * último que se le dijo.
 *
 * Devuelve true si ESTE camino ya atendió el mensaje. false = sigue sin
 * dueño y lo toma el bot (o se queda en la bandeja).
 */
async function applyReminderReply(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  text: string,
): Promise<boolean> {
  const template = barberWaTemplate("reminder");
  const last = await lastWordTo(shop.id, phone, template.name);
  const action = decideBarberReminderReply(text, last, template.name);
  if (!action || !last?.appointmentId) return false;

  // Dos recordatorios seguidos de visitas DISTINTAS al mismo número (el
  // celular de la familia) y un «confirmar» escrito: no se adivina cuál. Se
  // le dice y lo resuelve el mostrador. (Con botones no pasa: cada botón
  // trae su visita.)
  if (last.templateName === template.name && last.reminderStreak.length > 1) {
    await replyInline(shop, creds, phone, AMBIGUOUS_REPLY);
    return true;
  }

  return applyReminderAction(shop, creds, phone, action, {
    appointmentId: last.appointmentId,
    tapped: false,
  });
}

const STALE_BUTTON_REPLY =
  "Ese aviso ya no está vigente, así que no hice ningún cambio. Si necesitas algo de tu visita, escríbenos por aquí. 🙏";

/**
 * Ejecuta UNA acción sobre UNA visita concreta: la del recordatorio que el
 * cliente contestó, la del botón que tocó o la de la pregunta «¿Cancelo…?».
 * Nunca «la primera que tenga recordatorio».
 *
 * 🔴 CANCELAR NO CANCELA: PREGUNTA. La visita solo se cancela con `do-cancel`,
 * que llega cuando el cliente contesta «sí» a esa pregunta (o toca «Sí,
 * cancelar»), y se cancela la visita por la que se preguntó.
 *
 * La visita tiene que ser de ESTA barbería y de ESTE teléfono, seguir viva y
 * no ser una solicitud que la barbería aún no acepta. Las transiciones pasan
 * por canTransition() del contrato.
 */
async function applyReminderAction(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  action: BarberReminderAction,
  opts: { appointmentId: string; tapped: boolean },
): Promise<boolean> {
  const appt = await prisma.barberAppointment.findFirst({
    where: {
      id: opts.appointmentId,
      barbershopId: shop.id,
      OR: [{ clientPhone: phone }, { client: { phone } }],
    },
    select: { id: true, status: true, startAt: true, source: true },
  });

  const alive =
    appt !== null &&
    (appt.status === "PENDING" || appt.status === "CONFIRMED") &&
    appt.startAt.getTime() > Date.now() - 60 * 60 * 1000 &&
    // Una solicitud sin aceptar no se confirma ni se cancela desde aquí:
    // decidir sobre ella es de la barbería (pantalla Solicitudes).
    !isBarberUnacceptedRequest(appt);
  if (!appt || !alive) {
    // Un botón viejo merece respuesta (el cliente lo tocó y espera algo);
    // una palabra escrita sin visita viva no era para nosotros: al bot.
    if (opts.tapped) {
      await replyInline(shop, creds, phone, STALE_BUTTON_REPLY);
      return true;
    }
    return false;
  }

  const when = formatWhen(appt.startAt, shop.timezone, shop.locale);
  const current = appt.status as BarberAppointmentStatus;

  // 🔴 CANCELAR O MOVER EXIGE 2 HORAS DE ANTICIPACIÓN, igual que en «mi
  // cuenta». Dentro de esas dos horas la barbería ya no alcanza a llenar el
  // hueco: no se toca nada y se le da el teléfono para que llame. Confirmar
  // sí se puede hasta el último minuto.
  if (action !== "confirm" && action !== "keep" && barberTooLateToChange(appt.startAt)) {
    await replyInline(shop, creds, phone, barberLateChangeReply(shop.phone));
    return true;
  }

  if (action === "confirm") {
    if (canTransition(current, "CONFIRMED")) {
      await prisma.barberAppointment.update({ where: { id: appt.id }, data: { status: "CONFIRMED" } });
      await replyInline(shop, creds, phone, `✅ ¡Listo! Tu visita del ${when} está confirmada. Te esperamos.`);
    } else {
      await replyInline(shop, creds, phone, `✅ Tu visita del ${when} ya estaba confirmada. Te esperamos.`);
    }
    return true;
  }

  if (action === "ask-cancel") {
    // No se puede cancelar (ya está en curso): que lo explique el bot.
    if (!canTransition(current, "CANCELLED")) return false;
    await replyInline(
      shop,
      creds,
      phone,
      `¿Cancelo tu visita del ${when}? Responde *SÍ* para cancelarla o *NO* para conservarla.`,
      {
        buttons: barberCancelAskButtons(appt.id),
        // La fila recuerda POR QUÉ visita se preguntó: el «sí» cancela esa.
        templateName: BARBER_WA_CANCEL_ASK,
        appointmentId: appt.id,
      },
    );
    return true;
  }

  if (action === "do-cancel") {
    if (!canTransition(current, "CANCELLED")) return false;
    await prisma.$transaction(async (tx) => {
      await tx.barberAppointment.update({ where: { id: appt.id }, data: { status: "CANCELLED" } });
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
      `❌ Tu visita del ${when} quedó cancelada. Cuando quieras agendar de nuevo, escríbenos por aquí. ¡Nos vemos!`,
    );
    return true;
  }

  if (action === "keep") {
    await replyInline(shop, creds, phone, `👍 Perfecto, tu visita del ${when} sigue en pie. Te esperamos.`);
    return true;
  }

  // reschedule — NO se toca el estado de la visita: cambiar de horario es
  // elegir uno nuevo, y eso lo hace el cliente con el bot o el mostrador. El
  // hilo queda en el Inbox para que alguien lo atienda.
  await replyInline(
    shop,
    creds,
    phone,
    "🗓️ Con gusto te movemos la visita. Dinos qué día y a qué hora te queda mejor y te confirmamos el lugar.",
  );
  return true;
}

/**
 * De unas opciones al mensaje interactivo de Meta: botones de respuesta
 * (hasta 3, títulos de hasta 20 caracteres) o lista (hasta 10 filas). Los
 * límites y el armado son los del dental (interactivo.ts), ya probados
 * contra Meta. null = no se puede armar uno válido → va texto.
 */
function buildInteractive(
  body: string,
  choices: { id: string; titulo: string; descripcion?: string }[],
): { interactive: Record<string, unknown>; shape: MensajeInteractivo } | null {
  if (choices.length === 0) return null;
  const shape = interactivoParaOpciones(choices, "Ver opciones");
  if (!shape) return null;
  const interactive = construirInteractivo(body, shape);
  return interactive ? { interactive, shape } : null;
}

/** Manda un interactivo ya armado. Lanza WhatsAppApiError si Meta lo rechaza. */
async function sendInteractive(
  creds: BarberWaCredentials,
  to: string,
  interactive: Record<string, unknown>,
) {
  return postGraph(creds, {
    messaging_product: "whatsapp",
    to: normalizeMxWhatsAppPhone(to),
    type: "interactive",
    interactive,
  });
}

interface InlineExtras {
  /**
   * Opciones que ofrece el BOT. Su id lleva el prefijo del bot: es lo que le
   * dice a la ingesta, cuando el cliente la toca, que la respuesta es para él.
   * Si Meta rechaza el interactivo, salen como texto numerado.
   */
  options?: BarberBotOption[];
  /**
   * Botones con id PROPIO (los del recordatorio). Si Meta los rechaza sale
   * solo el cuerpo, que ya dice qué responder: numerarlos chocaría con el
   * «1 / 2 / 3» del recordatorio.
   */
  buttons?: BarberWaButton[];
  /** Marca interna de la fila (p. ej. la pregunta «¿Cancelo…?»). */
  templateName?: string | null;
  appointmentId?: string | null;
}

/**
 * Contesta al cliente EN EL MOMENTO. Solo se usa dentro de la ventana de
 * 24 h (acaba de escribirnos), así que va como texto: gratis y natural.
 * Best-effort — una respuesta que no sale no puede tumbar la ingesta.
 *
 * Con opciones o botones sale como mensaje INTERACTIVO para que el cliente
 * toque en vez de escribir. Si Meta lo RECHAZA sale como texto: el cliente
 * nunca se queda sin respuesta por un botón. (Un timeout NO cuenta como
 * rechazo: el mensaje pudo haber salido, y mandar el respaldo lo duplicaría.)
 */
async function replyInline(
  shop: ShopWaRow,
  creds: BarberWaCredentials | null,
  phone: string,
  body: string,
  extras: InlineExtras = {},
  /** true = Meta lo aceptó. La mayoría de quienes llaman no lo necesitan. */
): Promise<boolean> {
  if (!creds) return false;
  const options = extras.options ?? [];
  const buttons = extras.buttons ?? [];
  const rich =
    buttons.length > 0
      ? buildInteractive(
          body,
          buttons.map((b) => ({ id: b.id, titulo: b.title })),
        )
      : buildInteractive(
          body,
          options.map((o, i) => ({
            id: `${BARBER_BOT_OPTION_ID_PREFIX}${i + 1}`,
            titulo: o.title,
            ...(o.description ? { descripcion: o.description } : {}),
          })),
        );
  const row = await prisma.barberMessage
    .create({
      data: {
        barbershopId: shop.id,
        direction: "OUTBOUND",
        phone,
        // En la bandeja (y en lo que lee el bot en el turno siguiente) queda
        // también QUÉ se le ofreció: «🔘 Opciones: Corte · Barba».
        body: rich ? `${body}\n${lineaDeOpciones(rich.shape)}` : body,
        status: "PENDING",
        // Nace RECLAMADA: el drenado no puede mandarla una segunda vez.
        errorMessage: barberWaClaimMark(),
        templateName: extras.templateName ?? null,
        appointmentId: extras.appointmentId ?? null,
      },
      select: { id: true },
    })
    .catch(() => null);

  try {
    let wamid: string | null;
    let sentBody: string | null = null;
    if (rich) {
      try {
        wamid = (await sendInteractive(creds, phone, rich.interactive)).wamid;
      } catch (err) {
        if (!(err instanceof WhatsAppApiError)) throw err;
        console.warn(`[barber/wa] Meta rechazó los botones, va texto (${shop.id}): ${err.message}`);
        sentBody = buttons.length > 0 ? body : barberWaOptionsAsText(body, options);
        wamid = (await sendText(creds, phone, sentBody)).wamid;
      }
    } else {
      wamid = (await sendText(creds, phone, body)).wamid;
    }
    if (row) {
      await prisma.barberMessage.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          waMessageId: wamid,
          errorMessage: null,
          // Si salió el respaldo, la bandeja guarda lo que el cliente leyó.
          ...(sentBody ? { body: sentBody } : {}),
        },
      });
    }
    await consumeQuota(shop);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudo responder";
    if (row) {
      await prisma.barberMessage
        .update({ where: { id: row.id }, data: { status: "FAILED", errorMessage: message } })
        .catch(() => {});
    }
    return false;
  }
}

/* ─────────── ecos: lo que la barbería contesta desde SU celular ────────── */

/** Cómo queda en la bandeja un eco que no es texto. */
const ECHO_NON_TEXT: Record<string, string> = {
  image: "📷 Foto enviada desde el celular de la barbería",
  video: "🎥 Video enviado desde el celular de la barbería",
  audio: "🎤 Audio enviado desde el celular de la barbería",
  document: "📄 Archivo enviado desde el celular de la barbería",
  sticker: "Calcomanía enviada desde el celular de la barbería",
  location: "📍 Ubicación enviada desde el celular de la barbería",
  contacts: "👤 Contacto enviado desde el celular de la barbería",
};

/**
 * ECOS DE COEXISTENCE. Barber conecta el número en modo «coexistence»: el
 * dueño lo sigue usando en la app de WhatsApp Business de su celular. Lo que
 * conteste DESDE AHÍ no pasa por nosotros; Meta nos lo avisa después como un
 * «eco» (`message_echoes`). Hasta la ronda 2 esos ecos solo los leía el
 * dental, así que en barber:
 *   · la respuesta del dueño no aparecía en la bandeja (el hilo se veía sin
 *     contestar y los «sin leer» no bajaban);
 *   · el bot, que no la vio, contestaba ENCIMA del dueño.
 *
 * Aquí cada eco se guarda como un saliente ENVIADO (sin duplicar por wamid)
 * y el bot de ese hilo se pausa, igual que cuando alguien responde desde el
 * panel: 12 horas desde la última respuesta de una persona.
 *
 * La llama el webhook compartido SOLO cuando el phone_number_id no es de
 * ninguna clínica, dentro de try/catch y con import dinámico. Devuelve true
 * si el número era de una barbería.
 */
export async function ingestBarberEchoes(value: any): Promise<boolean> {
  const shop = await shopByPhoneNumberId(value?.metadata?.phone_number_id);
  if (!shop) return false;

  const echoes: any[] = Array.isArray(value?.message_echoes) ? value.message_echoes : [];
  const touched = new Set<string>();

  for (const echo of echoes) {
    try {
      const phone = mxTenDigits(typeof echo?.to === "string" ? echo.to : "");
      if (!phone) continue;
      const wamid = typeof echo?.id === "string" && echo.id ? echo.id : null;
      const text = typeof echo?.text?.body === "string" ? echo.text.body.trim() : "";
      // Solo lo que ES un mensaje: los ecos de "editar" o "borrar para todos"
      // no traen contenido y no se inventa una fila para ellos.
      const body = text || ECHO_NON_TEXT[String(echo?.type ?? "")] || "";
      if (!body) continue;

      const client = await prisma.barberClient.findUnique({
        where: { barbershopId_phone: { barbershopId: shop.id, phone } },
        select: { id: true },
      });

      // Mismo candado por wamid que la entrada: Meta reintenta el webhook, y
      // un mensaje que mandamos NOSOTROS por la API ya tiene su fila con ese
      // wamid — tampoco se duplica ni cuenta como «respondió una persona».
      const created = await prisma.$transaction(
        async (tx) => {
          if (wamid) {
            const [lockA, lockB] = advisoryLockKey(`barber:wa:out:${wamid}`);
            await tx.$executeRawUnsafe(
              `SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`,
            );
            const duplicate = await tx.barberMessage.findFirst({
              where: { barbershopId: shop.id, waMessageId: wamid, direction: "OUTBOUND" },
              select: { id: true },
            });
            if (duplicate) return false;
          }
          await tx.barberMessage.create({
            data: {
              barbershopId: shop.id,
              direction: "OUTBOUND",
              phone,
              body,
              waMessageId: wamid,
              // Ya salió (lo mandó el dueño desde su teléfono): nace ENVIADO,
              // y los estados de entrega de Meta lo siguen moviendo por wamid.
              status: "SENT",
              clientId: client?.id ?? null,
            },
          });
          return true;
        },
        { maxWait: 10_000, timeout: 15_000 },
      );
      if (created) touched.add(phone);
    } catch (err) {
      // Un eco ilegible no puede llevarse por delante a los demás.
      console.error(`[barber/wa] eco no guardado (${shop.id}):`, err);
    }
  }

  // Una persona tomó la conversación: el bot se calla en esos hilos.
  if (touched.size > 0) {
    try {
      const { noteBarberStaffReply } = await import("@/lib/barber/bot");
      for (const phone of Array.from(touched)) {
        await noteBarberStaffReply(shop.id, phone, "celular");
      }
    } catch (err) {
      console.error(`[barber/wa] no se pudo pausar el bot tras el eco (${shop.id}):`, err);
    }
  }
  return true;
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
    // …y la marca "[enviando]" tampoco: es un mensaje que está saliendo. Ni
    // las del turno del bot ("[bot:…]"), que viven en los ENTRANTES.
    error:
      isInvalidatedReminder(row.errorMessage) ||
      isBarberWaClaim(row.errorMessage) ||
      isBarberBotTurnMark(row.errorMessage)
        ? null
        : row.errorMessage,
    // Los adjuntos y las marcas de sistema no son "una plantilla".
    templateName:
      attachment ||
      isBarberWaSysRow(row.templateName) ||
      isBarberWaAskRow(row.templateName) ||
      isBarberWaAckRow(row.templateName)
        ? null
        : row.templateName,
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
  // Sin conversación todavía (el botón «WhatsApp» de la cita o la ficha abre
  // Mensajes con ?tel=), el nombre sale de la ficha del cliente de ESTA
  // barbería, para que el chat diga a quién le escribes (ws6-t8).
  const ficha =
    withClient?.client ??
    (await prisma.barberClient.findFirst({
      where: { barbershopId, phone: { in: [clean, `52${clean}`, `+52${clean}`, `521${clean}`] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }));

  return {
    messages: visible.reverse().map(toMessageDTO),
    windowOpen: barberWaWindowOpen(lastIn?.createdAt ?? null),
    clientId: ficha?.id ?? null,
    clientName: ficha?.name ?? null,
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
      errorMessage: barberWaClaimMark(),
      clientId: client?.id ?? null,
    },
    select: { id: true },
  });

  try {
    const { wamid } = await sendText(creds, phone, body);
    await prisma.barberMessage.update({
      where: { id: row.id },
      data: { status: "SENT", waMessageId: wamid, errorMessage: null },
    });
    await consumeQuota(shop);
    // Alguien de la barbería tomó la conversación: el bot se calla en este
    // hilo para no pisarle la respuesta (lo reanudan desde la pantalla del
    // bot). Import dinámico y sin lanzar, igual que runBotIfEnabled.
    try {
      const { noteBarberStaffReply } = await import("@/lib/barber/bot");
      await noteBarberStaffReply(shop.id, phone);
    } catch (err) {
      console.error(`[barber/wa] no se pudo pausar el bot tras responder (${shop.id}):`, err);
    }
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
