import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isMissingTableError } from "@/lib/barber/db-errors";
import { sumMoneyBy } from "@/lib/barber/money";
import { mxTenDigits } from "@/lib/phone-mx";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature, isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";
import { canTransition } from "@/lib/barber/types";
import { getBarberWaQuota } from "@/lib/barber/whatsapp";
import {
  isBarberOverlapError,
  pendingReminderInvalidationWhere,
  reminderInvalidationData,
} from "@/lib/barber/agenda";
import {
  createPublicBooking,
  getFreeBarbersByTime,
  getOpenDays,
  getPublicSlots,
} from "@/lib/barber/booking";
import {
  BARBER_BUSY_STATUSES,
  BARBER_MAX_DAYS_AHEAD,
  BARBER_MIN_LEAD_MIN,
  advisoryLockKey,
  addIsoDays,
  barberNowMinutes,
  barberTodayISO,
  barberTzLocalToUtc,
  getBarberTzParts,
  isValidIsoDate,
  parseHhMm,
  shortReference,
} from "@/lib/barber/booking-core";
import {
  DEFAULT_BARBER_BOT_SETTINGS,
  asksForHuman,
  autoPauseReason,
  botAnswersNow,
  botModelRequestExtras,
  botPauseExpired,
  botTurnCostMicros,
  botVoiceCostMicros,
  microsToMxn,
  normalizeBotOptions,
  normalizeBotSettings,
  quotaIsTight,
  BARBER_BOT_DEFAULT_MODEL,
  BARBER_BOT_OPTIONS_MAX,
  BARBER_BOT_PAUSE_OFF_HOURS,
  BARBER_BOT_USD_MXN_FALLBACK,
  MICROS_PER_MXN,
  type BarberBotBooking,
  type BarberBotOption,
  type BarberBotPanelState,
  type BarberBotPause,
  type BarberBotSettings,
  type BarberBotSkipReason,
  type BarberBotSpend,
} from "@/lib/barber/bot-core";

export * from "@/lib/barber/bot-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — EL BOT QUE AGENDA POR WHATSAPP.

   En México la mayoría de las barberías agenda por WhatsApp a mano. Esto es
   lo que convierte ese chat en agenda: el cliente escribe y sale con cita,
   sin que nadie de la barbería toque el teléfono.

   ── DÓNDE SE ENGANCHA ────────────────────────────────────────────────
   NO toca el transporte. `ingestBarberInbound` (whatsapp.ts) ya guardó el
   mensaje entrante y ya intentó resolverlo como respuesta a un
   recordatorio; solo si NADIE lo atendió llama aquí, y lo que esta función
   devuelve lo manda ESA capa con su propio `replyInline`. El bot decide QUÉ
   decir; whatsapp.ts decide CÓMO mandarlo. Así el bot no puede romper el
   envío ni el cupo.

   ── 🔴 LA REGLA QUE NO SE NEGOCIA ────────────────────────────────────
   EL BOT NUNCA INVENTA DISPONIBILIDAD.

   Los horarios que ofrece salen SIEMPRE de getPublicSlots/getOpenDays
   (booking.ts → agenda real: turnos del barbero, bloqueos y citas ya
   puestas). Y la cita la crea `createPublicBooking`, que vuelve a calcular
   quién está libre DENTRO de una transacción con pg_advisory_xact_lock. O
   sea: aunque el modelo alucinara una hora, la base la rechaza y el cliente
   recibe alternativas reales. La garantía es de Postgres, no del prompt.

   ── EL DINERO ────────────────────────────────────────────────────────
   · Los mensajes del bot son texto libre dentro de la ventana de 24 h
     (el cliente ACABA de escribir): categoría servicio, gratis. Aquí no se
     manda una sola plantilla, y menos de marketing.
   · Cupo de mensajes del plan: si se acabó, el bot calla y el panel lo
     dice. Nunca se corta en silencio.
   · Tope de gasto de IA POR BARBERÍA Y POR DÍA: un cliente insistente no
     puede disparar la cuenta. Al llegar al tope el bot no se apaga — pasa a
     modo sin IA (respuestas por reglas) y avisa en el panel.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Parámetros del turno ──────────────────────────────────────────── */

/**
 * Presupuesto de UN turno del bot. El webhook compartido declara
 * maxDuration = 60 s y la ingesta le pasa además SU propio límite
 * (`deadlineAt`), porque antes del bot puede haber gastado tiempo en bajar y
 * transcribir una nota de voz. Si Meta reintenta el webhook mientras tanto,
 * la ingesta lo descarta por wamid (con candado), así que no hay doble
 * respuesta.
 *
 * Antes eran 13 s para hasta cinco llamadas al modelo: un «agéndame el
 * sábado» (catálogo → horarios → agendar → contestar) no cabía, y el
 * cliente recibía «te paso con alguien» con la cita YA creada.
 */
const TURN_BUDGET_MS = 28_000;
/** Cada llamada al modelo, acotada aparte (lo mismo que el bot del dental). */
const AI_CALL_TIMEOUT_MS = 12_000;
/** Cuántas veces puede el modelo pedir herramientas antes de contestar. */
const MAX_TOOL_ROUNDS = 4;
/** Filas del hilo que se leen para armar el contexto. */
const MAX_HISTORY = 16;
/**
 * Techo de salida por llamada. Es un TECHO, no un gasto: se paga lo que el
 * modelo escribe. En la familia 5 aquí caben también el razonamiento y los
 * argumentos de las herramientas, y su tokenizador cuenta ~30 % más tokens
 * por el mismo texto: con los 700 de antes una respuesta podía cortarse.
 */
const MAX_OUTPUT_TOKENS = 2000;
/** Un WhatsApp largo no lo lee nadie. */
const MAX_REPLY_CHARS = 900;

/**
 * Modelo: el Sonnet vigente del bot del dental (BARBER_BOT_DEFAULT_MODEL en
 * bot-core.ts, junto a su tarifa). Se cambia por env sin redeploy.
 */
function aiModel(): string {
  return (process.env.BARBER_BOT_AI_MODEL || "").trim() || BARBER_BOT_DEFAULT_MODEL;
}

/** BARBER_BOT_AI_THINKING=off apaga el razonamiento donde el modelo lo permite. */
function aiThinking(): "auto" | "off" {
  return (process.env.BARBER_BOT_AI_THINKING || "").trim().toLowerCase() === "off" ? "off" : "auto";
}

/** Llave propia del vertical, con caída a la del dental (igual que Stripe). */
function aiApiKey(): string | null {
  const key =
    (process.env.BARBER_ANTHROPIC_API_KEY || "").trim() ||
    (process.env.ANTHROPIC_API_KEY || "").trim();
  return key || null;
}

function usdMxn(): number {
  const raw = Number(process.env.BARBER_BOT_USD_MXN);
  return Number.isFinite(raw) && raw > 0 ? raw : BARBER_BOT_USD_MXN_FALLBACK;
}

/* ═══════════════════════════════════════════════════════════════════════
   ALMACENAMIENTO — tres tablas propias: barber_bot_settings,
   barber_bot_usage y barber_bot_pauses (modelos BarberBotSettings,
   BarberBotUsage y BarberBotPause).

   Nacieron en sql/barber_bot.sql cuando el schema estaba congelado y hoy ya
   están en prisma/schema.prisma, así que se leen con el cliente Prisma. La
   red de seguridad NO se quitó: si esta base todavía no las tiene (P2021),
   TODO cae a los defaults (bot APAGADO) y el panel lo dice con todas sus
   letras. Nada truena y, sobre todo, el bot no contesta a ciegas.
   ═══════════════════════════════════════════════════════════════════════ */

const SETTINGS_TTL_MS = 20_000;
const settingsCache = new Map<
  string,
  { settings: BarberBotSettings; ready: boolean; at: number }
>();

export interface BarberBotSettingsResult {
  settings: BarberBotSettings;
  /** false = falta correr sql/barber_bot.sql en la base. */
  storageReady: boolean;
}

function requireShop(barbershopId: string): string {
  // Un `barbershopId: undefined` en un where de Prisma BORRA el filtro de
  // inquilino. Aquí se corta antes de llegar a ninguna consulta.
  if (typeof barbershopId !== "string" || !barbershopId) {
    throw new Error("[barber/bot] falta barbershopId");
  }
  return barbershopId;
}

export async function getBarberBotSettings(
  barbershopId: string,
): Promise<BarberBotSettingsResult> {
  const shopId = requireShop(barbershopId);
  const hit = settingsCache.get(shopId);
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) {
    return { settings: hit.settings, storageReady: hit.ready };
  }

  try {
    const row = await prisma.barberBotSettings.findUnique({
      where: { barbershopId: shopId },
      select: { settings: true },
    });
    const settings = normalizeBotSettings(row?.settings ?? null);
    settingsCache.set(shopId, { settings, ready: true, at: Date.now() });
    return { settings, storageReady: true };
  } catch (err) {
    // Sin tabla (P2021) o BD caída: apagado, que es el default seguro. Solo
    // se registra lo que NO es "falta la tabla".
    if (!isMissingTableError(err)) {
      console.warn("[barber/bot] no se pudo leer la configuración:", err);
    }
    const settings = normalizeBotSettings(null);
    settingsCache.set(shopId, { settings, ready: false, at: Date.now() });
    return { settings, storageReady: false };
  }
}

export class BarberBotStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BarberBotStorageError";
  }
}

export async function saveBarberBotSettings(
  barbershopId: string,
  raw: unknown,
): Promise<BarberBotSettings> {
  const shopId = requireShop(barbershopId);
  const settings = normalizeBotSettings(raw);
  // Ida y vuelta por JSON: el blob queda como lo dejaba el `::jsonb` de
  // antes (sin undefined) y con el tipo Json que pide Prisma.
  const payload = JSON.parse(JSON.stringify(settings)) as Prisma.InputJsonObject;

  try {
    await prisma.barberBotSettings.upsert({
      where: { barbershopId: shopId },
      create: { barbershopId: shopId, settings: payload },
      update: { settings: payload },
      select: { barbershopId: true },
    });
  } catch (err) {
    console.error("[barber/bot] no se pudo guardar la configuración:", err);
    throw new BarberBotStorageError(
      "Falta aplicar sql/barber_bot.sql en la base de datos para poder guardar el bot.",
    );
  }

  settingsCache.set(shopId, { settings, ready: true, at: Date.now() });
  return settings;
}

/* ── Pausas por conversación ───────────────────────────────────────── */

async function readPause(
  barbershopId: string,
  phone: string,
): Promise<{ reason: string | null; pausedAt: Date } | null> {
  try {
    return await prisma.barberBotPause.findUnique({
      where: { barbershopId_phone: { barbershopId, phone } },
      select: { reason: true, pausedAt: true },
    });
  } catch {
    // Sin tabla no hay pausas registradas. El bot ya está apagado por
    // defecto en ese escenario, así que esto no abre ninguna puerta.
    return null;
  }
}

/**
 * Pausa el bot en una conversación.
 *
 * `by: "staff"` (default) = la tomó una PERSONA: no caduca sola y, si ya
 * había una pausa del bot, la sustituye — a partir de ahí la conversación es
 * suya. `by: "bot"` = la puso el propio bot (fuera de horario, tope de IA,
 * el cliente pidió una persona): lleva la marca 🤖 y se quita sola según
 * botPauseExpired (bot-core.ts). Una pausa del bot nunca pisa una de persona.
 */
export async function pauseBarberBotThread(args: {
  barbershopId: string;
  phone: string;
  reason: string | null;
  by?: "staff" | "bot";
}): Promise<void> {
  const shopId = requireShop(args.barbershopId);
  const phone = mxTenDigits(args.phone);
  if (!phone) return;
  try {
    if (args.by === "bot") {
      const reason = autoPauseReason(args.reason ?? "");
      // skipDuplicates = ON CONFLICT DO NOTHING: si el hilo ya estaba en
      // pausa (del bot o de una persona), se conserva la primera.
      await prisma.barberBotPause.createMany({
        data: [{ barbershopId: shopId, phone, reason }],
        skipDuplicates: true,
      });
      return;
    }
    const reason = args.reason ? args.reason.trim().slice(0, 180) : null;
    await prisma.barberBotPause.upsert({
      where: { barbershopId_phone: { barbershopId: shopId, phone } },
      create: { barbershopId: shopId, phone, reason },
      update: { reason, pausedAt: new Date() },
      select: { phone: true },
    });
  } catch (err) {
    console.error("[barber/bot] no se pudo pausar la conversación:", err);
  }
}

/**
 * Alguien de la barbería contestó A MANO en este hilo (desde la bandeja del
 * panel). A partir de ahí la conversación es de esa persona: el bot se calla
 * hasta que la reanuden, para no pisarle la respuesta al cliente. Solo hace
 * algo si el bot de la barbería está encendido. Nunca lanza.
 */
export async function noteBarberStaffReply(barbershopId: string, phone: string): Promise<void> {
  try {
    const { settings, storageReady } = await getBarberBotSettings(requireShop(barbershopId));
    if (!storageReady || !settings.enabled) return;
    await pauseBarberBotThread({
      barbershopId,
      phone,
      reason: "Alguien de la barbería respondió desde el panel",
      by: "staff",
    });
  } catch (err) {
    console.error("[barber/bot] no se pudo anotar la respuesta del equipo:", err);
  }
}

export async function resumeBarberBotThread(args: {
  barbershopId: string;
  phone: string;
}): Promise<void> {
  const shopId = requireShop(args.barbershopId);
  const phone = mxTenDigits(args.phone);
  if (!phone) return;
  try {
    await prisma.barberBotPause.deleteMany({ where: { barbershopId: shopId, phone } });
  } catch (err) {
    console.error("[barber/bot] no se pudo reanudar la conversación:", err);
  }
}

export async function listBarberBotPauses(barbershopId: string): Promise<BarberBotPause[]> {
  const shopId = requireShop(barbershopId);
  try {
    const rows = await prisma.barberBotPause.findMany({
      where: { barbershopId: shopId },
      select: { phone: true, reason: true, pausedAt: true },
      orderBy: { pausedAt: "desc" },
      take: 100,
    });
    return rows.map((r) => ({
      phone: r.phone,
      reason: r.reason,
      pausedAt: r.pausedAt.toISOString(),
    }));
  } catch {
    return [];
  }
}

/* ── Gasto de IA del día ───────────────────────────────────────────── */

async function readSpendMicros(barbershopId: string, day: string): Promise<number> {
  try {
    const row = await prisma.barberBotUsage.findUnique({
      where: { barbershopId_day: { barbershopId, day } },
      select: { spentMicros: true },
    });
    if (!row) return 0;
    return Number(row.spentMicros) || 0;
  } catch {
    // Sin tabla NO hay tope posible. Devolver 0 dejaría la IA sin freno, así
    // que se devuelve Infinity: sin almacenamiento, no se gasta.
    return Number.POSITIVE_INFINITY;
  }
}

async function addSpend(
  barbershopId: string,
  day: string,
  micros: number,
  /** 0 para lo que gasta IA sin ser un turno del bot (transcribir un audio). */
  turns = 1,
): Promise<void> {
  if (!Number.isFinite(micros) || micros <= 0) return;
  const add = BigInt(Math.round(micros));
  try {
    // Acumulación ATÓMICA: con la PK compuesta en el where y sin escrituras
    // anidadas, Prisma lo ejecuta como un solo
    // INSERT … ON CONFLICT DO UPDATE SET spentMicros = spentMicros + $n
    // (verificado con el log de sentencias SQL), así que dos turnos a la vez
    // no se pisan el gasto.
    await prisma.barberBotUsage.upsert({
      where: { barbershopId_day: { barbershopId, day } },
      create: { barbershopId, day, spentMicros: add, turns },
      update: { spentMicros: { increment: add }, turns: { increment: turns } },
      select: { barbershopId: true },
    });
  } catch (err) {
    // La llamada YA se hizo y ya se pagó: no contarla es mejor que tumbar
    // la respuesta al cliente. Queda el rastro en el log.
    console.error("[barber/bot] no se pudo registrar el gasto de IA:", err);
  }
}

export async function getBarberBotSpend(
  barbershopId: string,
  timezone: string,
  capMxn: number,
): Promise<BarberBotSpend> {
  const shopId = requireShop(barbershopId);
  const day = barberTodayISO(timezone);
  const micros = await readSpendMicros(shopId, day);
  const finite = Number.isFinite(micros) ? micros : 0;
  const capMicros = Math.max(0, capMxn) * MICROS_PER_MXN;
  return {
    day,
    spentMxn: microsToMxn(finite),
    capMxn,
    turns: 0,
    capReached: !Number.isFinite(micros) || micros >= capMicros,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   CONTEXTO DEL TURNO — lo que el bot sabe de esta barbería y este cliente.
   ═══════════════════════════════════════════════════════════════════════ */

const BOT_SHOP_SELECT = {
  id: true,
  name: true,
  slug: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  timezone: true,
  locale: true,
  plan: true,
  subscriptionStatus: true,
  isActive: true,
  parentId: true,
} as const;

type BotShopRow = {
  id: string;
  name: string;
  slug: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  locale: string;
  plan: string;
  subscriptionStatus: string;
  isActive: boolean;
  parentId: string | null;
};

interface BotServiceRow {
  id: string;
  name: string;
  durationMin: number;
  price: number;
}

interface BotBarberRow {
  id: string;
  name: string;
}

interface BotAppointmentRow {
  id: string;
  startAt: Date;
  endAt: Date;
  status: string;
  barberName: string | null;
  services: string[];
}

interface BotClientInfo {
  id: string | null;
  name: string | null;
  totalVisits: number;
  /** Lo de siempre: último servicio y barbero que se llevó. */
  usualServiceIds: string[];
  usualServiceNames: string[];
  usualBarberId: string | null;
  usualBarberName: string | null;
}

async function loadBotShop(barbershopId: string): Promise<BotShopRow | null> {
  // select explícito: la fila completa de Barbershop trae el token de
  // WhatsApp y los ids de Stripe. Nunca se carga entera "por si acaso".
  return (await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: BOT_SHOP_SELECT,
  })) as BotShopRow | null;
}

async function loadServices(barbershopId: string): Promise<BotServiceRow[]> {
  const rows = await prisma.barberService.findMany({
    where: { barbershopId, isActive: true },
    select: { id: true, name: true, durationMin: true, price: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 40,
  });
  // 🔴 Los precios salen de BarberService. Jamás de una constante ni del
  // modelo: si el precio cambia en el panel, cambia en el chat.
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    durationMin: r.durationMin,
    price: Number(r.price),
  }));
}

async function loadBarbers(barbershopId: string): Promise<BotBarberRow[]> {
  const rows = await prisma.barber.findMany({
    where: { barbershopId, isActive: true },
    select: { id: true, name: true, nickname: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 30,
  });
  return rows.map((r) => ({ id: r.id, name: r.nickname || r.name }));
}

/**
 * Horario de atención tal como lo tienen los barberos, resumido por día.
 * Es informativo (para contestar "¿a qué hora abren?"); los HUECOS siguen
 * saliendo del motor de disponibilidad, nunca de aquí.
 */
async function loadShopHours(barbershopId: string): Promise<string> {
  const rows = await prisma.barberSchedule.findMany({
    where: { barbershopId, isActive: true },
    select: { dayOfWeek: true, startMinute: true, endMinute: true },
  });
  if (rows.length === 0) return "(La barbería no tiene horarios cargados.)";

  const names = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const byDay = new Map<number, { start: number; end: number }>();
  for (const r of rows) {
    const cur = byDay.get(r.dayOfWeek);
    byDay.set(r.dayOfWeek, {
      start: cur ? Math.min(cur.start, r.startMinute) : r.startMinute,
      end: cur ? Math.max(cur.end, r.endMinute) : r.endMinute,
    });
  }
  const out: string[] = [];
  for (let d = 0; d < 7; d++) {
    const w = byDay.get(d);
    if (w) out.push(`${names[d]}: ${hhmm(w.start)} a ${hhmm(w.end)}`);
  }
  return out.length > 0 ? out.join(" · ") : "(La barbería no tiene horarios cargados.)";
}

function hhmm(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

async function loadClientInfo(
  barbershopId: string,
  phone: string,
): Promise<BotClientInfo> {
  const empty: BotClientInfo = {
    id: null,
    name: null,
    totalVisits: 0,
    usualServiceIds: [],
    usualServiceNames: [],
    usualBarberId: null,
    usualBarberName: null,
  };

  const client = await prisma.barberClient.findUnique({
    where: { barbershopId_phone: { barbershopId, phone } },
    select: { id: true, name: true, totalVisits: true, blockedAt: true },
  });
  if (!client) return empty;
  // Un cliente bloqueado no recibe trato de conocido; la reserva se le
  // rechaza igual más adelante (createPublicBooking → clientBlocked).
  if (client.blockedAt) return { ...empty, id: client.id, name: client.name };

  const last = await prisma.barberAppointment.findFirst({
    where: {
      barbershopId,
      clientId: client.id,
      status: { in: ["DONE", "CONFIRMED"] },
    },
    orderBy: { startAt: "desc" },
    select: {
      barberId: true,
      barber: { select: { name: true, nickname: true } },
      services: { select: { serviceId: true, service: { select: { name: true, isActive: true } } } },
    },
  });

  if (!last) {
    return { ...empty, id: client.id, name: client.name, totalVisits: client.totalVisits };
  }

  // Un servicio que la barbería retiró ya no es "lo de siempre".
  const alive = last.services.filter((s) => s.service?.isActive);
  return {
    id: client.id,
    name: client.name,
    totalVisits: client.totalVisits,
    usualServiceIds: alive.map((s) => s.serviceId),
    usualServiceNames: alive.map((s) => s.service?.name ?? "").filter(Boolean),
    usualBarberId: last.barberId,
    usualBarberName: last.barber ? last.barber.nickname || last.barber.name : null,
  };
}

async function loadUpcoming(
  barbershopId: string,
  phone: string,
): Promise<BotAppointmentRow[]> {
  const rows = await prisma.barberAppointment.findMany({
    where: {
      barbershopId,
      // El teléfono de la cita O el de la ficha: una cita creada en el panel
      // antes de que al cliente le corrigieran el número sigue siendo suya.
      OR: [{ clientPhone: phone }, { client: { phone } }],
      startAt: { gte: new Date() },
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    orderBy: { startAt: "asc" },
    take: 5,
    select: {
      id: true,
      startAt: true,
      endAt: true,
      status: true,
      barber: { select: { name: true, nickname: true } },
      services: { select: { service: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    startAt: r.startAt,
    endAt: r.endAt,
    status: r.status,
    barberName: r.barber ? r.barber.nickname || r.barber.name : null,
    services: r.services.map((s) => s.service?.name ?? "").filter(Boolean),
  }));
}

/* ── Formato de fechas en español ──────────────────────────────────── */

const WEEKDAYS_ES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];
const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function isoWeekday(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "sábado 30 de agosto" — como lo diría una persona. */
export function humanDate(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  if (!y || !m || !d) return dateISO;
  return `${WEEKDAYS_ES[isoWeekday(dateISO)]} ${d} de ${MONTHS_ES[m - 1]}`;
}

/** 14:30 → "2:30 pm". La gente no lee horarios de 24 h en un chat. */
export function humanTime(hhmmValue: string): string {
  const min = parseHhMm(hhmmValue);
  if (min === null) return hhmmValue;
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function money(value: number): string {
  return `$${Math.round(value)}`;
}

/* ═══════════════════════════════════════════════════════════════════════
   HERRAMIENTAS — lo ÚNICO con lo que el modelo toca el mundo real.

   Cada una devuelve datos de la base. El modelo no puede inventar un
   horario porque los horarios solo existen dentro de estas respuestas, y no
   puede crear una cita fantasma porque `agendar` pasa por
   createPublicBooking (candado + recálculo dentro de la transacción).
   ═══════════════════════════════════════════════════════════════════════ */

interface ToolCtx {
  shop: BotShopRow;
  phone: string;
  services: BotServiceRow[];
  barbers: BotBarberRow[];
  client: BotClientInfo;
  settings: BarberBotSettings;
  now: Date;
  /** Horario de la barbería ya resumido (informativo, no decide huecos). */
  hoursText: string;
  /** Efectos que el turno provocó — el panel los muestra. */
  effects: BotEffects;
}

export interface BotEffects {
  booked: string[];
  cancelled: string[];
  rescheduled: string[];
  handoff: boolean;
  handoffReason: string | null;
  /**
   * Lo que el turno HIZO, ya en frases para el cliente. Es la red de
   * seguridad: si el modelo agenda y luego no alcanza a contestar (se acabó
   * el tiempo, la IA falló), el cliente recibe esto y no un «te paso con
   * alguien» con la cita ya creada.
   */
  summary: string[];
  /** Respuesta que el modelo cerró con responder_con_opciones. */
  finalText: string | null;
  finalOptions: BarberBotOption[];
}

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function toolDefs(settings: BarberBotSettings): ToolDef[] {
  const defs: ToolDef[] = [];
  const a = settings.abilities;

  if (a.precios) {
    defs.push({
      name: "listar_servicios",
      description:
        "Servicios que ofrece la barbería con su precio real y su duración. " +
        "Úsala SIEMPRE antes de decir un precio: nunca los inventes ni los recuerdes de otra conversación.",
      input_schema: { type: "object", properties: {}, required: [] },
    });
  }

  if (a.agendar) {
    defs.push({
      name: "buscar_horarios",
      description:
        "Horarios REALMENTE libres de un día. Es la ÚNICA fuente de horarios: " +
        "no ofrezcas ninguna hora que no venga de aquí. Si el día no tiene nada, " +
        "la respuesta trae los siguientes días con lugar.",
      input_schema: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "Día en formato AAAA-MM-DD." },
          servicioIds: {
            type: "array",
            items: { type: "string" },
            description: "Ids de los servicios que quiere. Definen la duración.",
          },
          barberoId: {
            type: "string",
            description: "Id del barbero si pidió uno. Omítelo para cualquiera.",
          },
        },
        required: ["fecha", "servicioIds"],
      },
    });

    defs.push({
      name: "agendar",
      description:
        "Crea la cita. Úsala solo cuando ya tengas día, hora (salida de buscar_horarios), " +
        "servicios y el nombre del cliente, y él haya dicho que sí. " +
        "Si el hueco se ocupó mientras conversaban, la respuesta lo dirá: " +
        "díselo y ofrece las alternativas que trae.",
      input_schema: {
        type: "object",
        properties: {
          fecha: { type: "string", description: "AAAA-MM-DD." },
          hora: { type: "string", description: "HH:MM en 24 h, tal cual la dio buscar_horarios." },
          servicioIds: { type: "array", items: { type: "string" } },
          barberoId: { type: "string", description: "Opcional." },
          nombre: { type: "string", description: "Nombre del cliente." },
        },
        required: ["fecha", "hora", "servicioIds", "nombre"],
      },
    });
  }

  if (a.cancelar || a.reagendar) {
    defs.push({
      name: "mis_citas",
      description: "Citas futuras de ESTE teléfono, con su id, para poder cancelarlas o moverlas.",
      input_schema: { type: "object", properties: {}, required: [] },
    });
  }

  if (a.cancelar) {
    defs.push({
      name: "cancelar",
      description: "Cancela una cita del cliente. Confirma con él antes de usarla.",
      input_schema: {
        type: "object",
        properties: { citaId: { type: "string" } },
        required: ["citaId"],
      },
    });
  }

  if (a.reagendar) {
    defs.push({
      name: "reagendar",
      description:
        "Mueve una cita a otro día u hora. La hora debe salir de buscar_horarios.",
      input_schema: {
        type: "object",
        properties: {
          citaId: { type: "string" },
          fecha: { type: "string", description: "AAAA-MM-DD." },
          hora: { type: "string", description: "HH:MM en 24 h." },
        },
        required: ["citaId", "fecha", "hora"],
      },
    });
  }

  defs.push({
    name: "responder_con_opciones",
    description:
      "Tu respuesta al cliente CON botones para que toque en vez de escribir. " +
      "Úsala cuando le des a elegir entre opciones concretas: qué servicio quiere, " +
      "qué horario de los que dio buscar_horarios, o un sí/no antes de agendar o cancelar. " +
      `Entre 2 y ${BARBER_BOT_OPTIONS_MAX} opciones. Lo que toque te llega como su siguiente mensaje, ` +
      "con el título tal cual. Esta herramienta CIERRA tu turno: no escribas nada más después.",
    input_schema: {
      type: "object",
      properties: {
        texto: {
          type: "string",
          description:
            "El mensaje completo, como lo escribirías normalmente (incluye el día si ofreces horarios).",
        },
        opciones: {
          type: "array",
          items: {
            type: "object",
            properties: {
              titulo: {
                type: "string",
                description:
                  "Corto, hasta 20 caracteres: «Corte», «5:30 pm», «Sí, agéndala». Sin repetir títulos.",
              },
              descripcion: {
                type: "string",
                description: "Opcional. Detalle breve: precio y duración, o el día del horario.",
              },
            },
            required: ["titulo"],
          },
        },
      },
      required: ["texto", "opciones"],
    },
  });

  defs.push({
    name: "pasar_con_persona",
    description:
      "Pasa la conversación a alguien de la barbería. Úsala si el cliente lo pide, " +
      "si se queja, si pregunta algo que no está en tus datos, o si algo no cuadra. " +
      "Vale más pasarla que inventar.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "En pocas palabras, para el panel." },
      },
      required: ["motivo"],
    },
  });

  return defs;
}

function resolveServiceIds(ctx: ToolCtx, raw: unknown): BotServiceRow[] {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter((v): v is string => typeof v === "string" && !!v));
  return ctx.services.filter((s) => wanted.has(s.id));
}

function resolveBarberId(ctx: ToolCtx, raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || raw === "any") return null;
  return ctx.barbers.some((b) => b.id === raw) ? raw : null;
}

/** Ejecuta una herramienta. NUNCA lanza: devuelve el error como dato. */
async function runTool(
  ctx: ToolCtx,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case "listar_servicios":
        return {
          servicios: ctx.services.map((s) => ({
            id: s.id,
            nombre: s.name,
            precio: money(s.price),
            duracionMin: s.durationMin,
          })),
          barberos: ctx.barbers.map((b) => ({ id: b.id, nombre: b.name })),
        };

      case "buscar_horarios":
        return await toolBuscarHorarios(ctx, input);

      case "agendar":
        return await toolAgendar(ctx, input);

      case "mis_citas":
        return await toolMisCitas(ctx);

      case "cancelar":
        return await toolCancelar(ctx, input);

      case "reagendar":
        return await toolReagendar(ctx, input);

      case "responder_con_opciones": {
        const texto = typeof input.texto === "string" ? input.texto.trim() : "";
        if (!texto) return { error: "Falta el texto del mensaje." };
        ctx.effects.finalText = texto;
        ctx.effects.finalOptions = normalizeBotOptions(input.opciones);
        return { ok: true };
      }

      case "pasar_con_persona": {
        const motivo =
          typeof input.motivo === "string" ? input.motivo.trim().slice(0, 180) : null;
        ctx.effects.handoff = true;
        ctx.effects.handoffReason = motivo;
        return { ok: true, aviso: "Listo, alguien de la barbería sigue la conversación." };
      }

      default:
        return { error: "Esa herramienta no existe." };
    }
  } catch (err) {
    console.error(`[barber/bot] herramienta ${name} falló:`, err);
    return { error: "No se pudo consultar eso ahorita." };
  }
}

async function toolBuscarHorarios(
  ctx: ToolCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  const services = resolveServiceIds(ctx, input.servicioIds);
  if (services.length === 0) {
    return { error: "Faltan los servicios. Usa listar_servicios y pregúntale al cliente." };
  }
  const durationMin = services.reduce((acc, s) => acc + s.durationMin, 0);
  const barberId = resolveBarberId(ctx, input.barberoId);

  const dateISO = typeof input.fecha === "string" ? input.fecha : "";
  if (!isValidIsoDate(dateISO)) return { error: "La fecha debe ser AAAA-MM-DD." };

  const todayISO = barberTodayISO(ctx.shop.timezone, ctx.now);
  if (dateISO < todayISO) {
    return { error: "Ese día ya pasó.", hoy: todayISO };
  }

  const shop = { id: ctx.shop.id, timezone: ctx.shop.timezone };
  const slots = await getPublicSlots({
    shop,
    dateISO,
    durationMin,
    barberId,
    now: ctx.now,
  });

  if (slots.length > 0) {
    return {
      fecha: dateISO,
      fechaBonita: humanDate(dateISO),
      // Se mandan TODOS los huecos reales; el modelo elige cuáles ofrecer,
      // pero no puede salirse de esta lista.
      horarios: slots.map((s) => ({ hora: s.time, comoSeDice: humanTime(s.time) })),
      duracionMin: durationMin,
    };
  }

  // Día sin nada: se le dan los siguientes días abiertos para que la
  // conversación avance en vez de morir en un "no hay".
  const open = await getOpenDays({
    shop,
    fromISO: dateISO,
    days: Math.min(21, BARBER_MAX_DAYS_AHEAD),
    durationMin,
    barberId,
    now: ctx.now,
  });
  return {
    fecha: dateISO,
    horarios: [],
    aviso: "Ese día no tiene lugar.",
    siguientesDias: open.slice(0, 5).map((d) => ({ fecha: d, fechaBonita: humanDate(d) })),
    duracionMin: durationMin,
  };
}

async function toolAgendar(ctx: ToolCtx, input: Record<string, unknown>): Promise<unknown> {
  const services = resolveServiceIds(ctx, input.servicioIds);
  if (services.length === 0) return { error: "Faltan los servicios." };

  const dateISO = typeof input.fecha === "string" ? input.fecha : "";
  const time = typeof input.hora === "string" ? input.hora : "";
  const nombre = typeof input.nombre === "string" ? input.nombre.trim() : "";
  if (!nombre || nombre.length < 2) {
    return { error: "Falta el nombre del cliente. Pregúntaselo antes de agendar." };
  }

  const barberId = resolveBarberId(ctx, input.barberoId);
  const durationMin = services.reduce((acc, s) => acc + s.durationMin, 0);

  // El row completo de Barbershop que pide createPublicBooking. Se relee con
  // su propio select (el nuestro es más corto a propósito).
  const shopRow = await prisma.barbershop.findUnique({
    where: { id: ctx.shop.id },
    select: {
      id: true,
      slug: true,
      name: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      state: true,
      timezone: true,
      locale: true,
      logoUrl: true,
      plan: true,
      subscriptionStatus: true,
      isActive: true,
    },
  });
  if (!shopRow) return { error: "No se encontró la barbería." };

  const result = await createPublicBooking({
    shop: shopRow as never,
    serviceIds: services.map((s) => s.id),
    barberId,
    dateISO,
    time,
    clientName: nombre,
    phone: ctx.phone,
    notes: "Agendada por el bot de WhatsApp.",
    now: ctx.now,
    // La cita nace marcada como del canal correcto y SIN mandar la
    // plantilla de confirmación: el cliente está leyendo la respuesta del
    // bot en ese mismo chat. Mandarla sería cobrarle un mensaje al plan
    // para decirle dos veces lo mismo.
    source: "WHATSAPP",
    skipNotify: true,
  });

  if (result.ok === false) {
    return await bookingErrorPayload(ctx, result.code, {
      dateISO,
      durationMin,
      barberId,
    });
  }

  if (!result.duplicate) {
    ctx.effects.booked.push(result.reference);
    ctx.effects.summary.push(
      `✅ Tu cita quedó ${result.status === "CONFIRMED" ? "confirmada" : "apartada"} para el ` +
        `${humanDate(dateISO)} a las ${humanTime(time)}` +
        (result.barberName ? ` con ${result.barberName}` : "") +
        `. Tu folio es ${result.reference}.` +
        (result.status === "CONFIRMED" ? "" : " La barbería te la confirma en un momento."),
    );
  }
  return {
    ok: true,
    referencia: result.reference,
    estado: result.status === "CONFIRMED" ? "confirmada" : "por confirmar",
    // Cuando la barbería revisa a mano, la cita nace PENDING: decirle
    // "confirmada" al cliente sería mentirle.
    aclaracion:
      result.status === "CONFIRMED"
        ? "La cita quedó confirmada."
        : "La cita quedó apartada y la barbería la confirma en un momento.",
    fechaBonita: humanDate(dateISO),
    horaBonita: humanTime(time),
    barbero: result.barberName,
    servicios: result.services.map((s) => s.name),
    total: money(result.total),
    duplicada: result.duplicate,
  };
}

/**
 * Un error de reserva se le devuelve al modelo COMO DATO, con alternativas
 * cuando las hay: así el bot dice la verdad y sigue ayudando, en vez de
 * quedarse callado o inventar.
 */
async function bookingErrorPayload(
  ctx: ToolCtx,
  code: string,
  args: { dateISO: string; durationMin: number; barberId: string | null },
): Promise<unknown> {
  const shop = { id: ctx.shop.id, timezone: ctx.shop.timezone };

  if (code === "slotTaken") {
    const slots = await getPublicSlots({
      shop,
      dateISO: args.dateISO,
      durationMin: args.durationMin,
      barberId: args.barberId,
      now: ctx.now,
    }).catch(() => []);
    return {
      error: "ocupado",
      mensaje:
        "Ese horario se acaba de ocupar. Ofrécele estas alternativas REALES y vuelve a agendar la que elija.",
      alternativas: slots.map((s) => ({ hora: s.time, comoSeDice: humanTime(s.time) })),
    };
  }

  const messages: Record<string, string> = {
    pastDate: "Ese horario ya pasó o es demasiado pronto. Ofrécele uno más adelante.",
    tooFar: `Solo se puede agendar hasta ${BARBER_MAX_DAYS_AHEAD} días adelante.`,
    noServices: "Alguno de los servicios ya no existe. Vuelve a consultar listar_servicios.",
    badBarber: "Ese barbero ya no está disponible. Ofrécele otro o 'cualquiera'.",
    tooManyOpen:
      "Este teléfono ya tiene el máximo de citas apartadas. Dile que primero cancele una, o pasa la conversación a una persona.",
    clientBlocked: "No se puede agendar con este cliente. Pasa la conversación a una persona.",
    shopInactive: "La barbería está desactivada.",
    planOff: "La barbería no puede recibir reservas ahorita.",
    badRequest: "Los datos no son válidos. Revisa la fecha y la hora.",
  };
  return { error: code, mensaje: messages[code] ?? "No se pudo agendar." };
}

async function toolMisCitas(ctx: ToolCtx): Promise<unknown> {
  const rows = await loadUpcoming(ctx.shop.id, ctx.phone);
  return {
    citas: rows.map((r) => {
      const parts = getBarberTzParts(r.startAt, ctx.shop.timezone);
      const dateISO = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
      return {
        citaId: r.id,
        referencia: shortReference(r.id),
        fechaBonita: humanDate(dateISO),
        horaBonita: humanTime(hhmm(parts.hour * 60 + parts.minute)),
        estado: r.status === "CONFIRMED" ? "confirmada" : "por confirmar",
        barbero: r.barberName,
        servicios: r.services,
      };
    }),
  };
}

/** Solo citas de ESTE teléfono y ESTA barbería pueden tocarse. */
async function ownAppointment(ctx: ToolCtx, citaId: unknown) {
  if (typeof citaId !== "string" || !citaId) return null;
  return prisma.barberAppointment.findFirst({
    where: {
      id: citaId,
      barbershopId: ctx.shop.id,
      OR: [{ clientPhone: ctx.phone }, { client: { phone: ctx.phone } }],
    },
    select: {
      id: true,
      status: true,
      startAt: true,
      barberId: true,
      services: { select: { serviceId: true, service: { select: { durationMin: true } } } },
    },
  });
}

async function toolCancelar(ctx: ToolCtx, input: Record<string, unknown>): Promise<unknown> {
  const appt = await ownAppointment(ctx, input.citaId);
  if (!appt) return { error: "No encontré esa cita a nombre de este teléfono." };

  if (!canTransition(appt.status as never, "CANCELLED")) {
    return {
      error: "noSePuede",
      mensaje:
        appt.status === "CANCELLED"
          ? "Esa cita ya estaba cancelada."
          : "Esa cita ya no se puede cancelar desde aquí. Pasa la conversación a una persona.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.barberAppointment.update({
      where: { id: appt.id },
      data: { status: "CANCELLED" },
    });
    // Los recordatorios en cola de esa cita dejan de tener sentido. Se
    // invalidan con los helpers del contrato, no con una marca inventada.
    await tx.barberMessage.updateMany({
      where: pendingReminderInvalidationWhere(ctx.shop.id, appt.id),
      data: reminderInvalidationData("CANCELLED"),
    });
  });

  ctx.effects.cancelled.push(shortReference(appt.id));
  ctx.effects.summary.push(`❌ Tu cita ${shortReference(appt.id)} quedó cancelada.`);
  return { ok: true, referencia: shortReference(appt.id) };
}

/**
 * REAGENDAR — mover la cita a otro hueco.
 *
 * Mismo criterio que createPublicBooking y por la misma razón: el candado
 * por (barbería, día) serializa a quien toque ese día, y la disponibilidad
 * se recalcula DENTRO de la transacción. Lo que se pintó en el chat no
 * decide nada; decide Postgres.
 *
 * Se hace como UPDATE y no como "cancelar + crear" a propósito: así la cita
 * conserva su historia (y no choca contra el tope de citas abiertas por
 * teléfono, que rechazaría el movimiento del cliente más fiel).
 */
async function toolReagendar(ctx: ToolCtx, input: Record<string, unknown>): Promise<unknown> {
  const appt = await ownAppointment(ctx, input.citaId);
  if (!appt) return { error: "No encontré esa cita a nombre de este teléfono." };
  if (appt.status !== "PENDING" && appt.status !== "CONFIRMED") {
    return { error: "noSePuede", mensaje: "Esa cita ya no se puede mover." };
  }

  const dateISO = typeof input.fecha === "string" ? input.fecha : "";
  const time = typeof input.hora === "string" ? input.hora : "";
  const startMinute = parseHhMm(time);
  if (!isValidIsoDate(dateISO) || startMinute === null) {
    return { error: "badRequest", mensaje: "Revisa la fecha (AAAA-MM-DD) y la hora (HH:MM)." };
  }

  const durationMin = appt.services.reduce(
    (acc, s) => acc + (s.service?.durationMin ?? 0),
    0,
  );
  if (durationMin <= 0) {
    return { error: "noSePuede", mensaje: "Esa cita no tiene servicios. Pásala con una persona." };
  }

  const todayISO = barberTodayISO(ctx.shop.timezone, ctx.now);
  if (dateISO < todayISO) return { error: "pastDate", mensaje: "Ese día ya pasó." };
  if (
    dateISO === todayISO &&
    startMinute <= barberNowMinutes(ctx.shop.timezone, ctx.now) + BARBER_MIN_LEAD_MIN
  ) {
    return { error: "pastDate", mensaje: "Esa hora es demasiado pronto. Ofrécele una más tarde." };
  }

  const startAt = barberTzLocalToUtc(
    dateISO,
    Math.floor(startMinute / 60),
    startMinute % 60,
    ctx.shop.timezone,
  );
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);
  const [lockA, lockB] = advisoryLockKey(`barber:booking:${ctx.shop.id}:${dateISO}`);

  try {
    const moved = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${Math.trunc(lockA)}, ${Math.trunc(lockB)})`,
        );

        const free = await getFreeBarbersByTime({
          shop: { id: ctx.shop.id, timezone: ctx.shop.timezone },
          dateISO,
          durationMin,
          barberId: appt.barberId,
          now: ctx.now,
          db: tx,
        });
        let candidates = free.get(time) ?? [];

        // El barbero de la cita ocupa su propio lugar: al recalcular, ese
        // hueco se ve tomado por ella misma. Se descuenta comprobando si el
        // único estorbo es la cita que estamos moviendo.
        if (candidates.length === 0 && appt.barberId) {
          const clashes = await tx.barberAppointment.findMany({
            where: {
              barbershopId: ctx.shop.id,
              barberId: appt.barberId,
              startAt: { lt: endAt },
              endAt: { gt: startAt },
              status: { in: [...BARBER_BUSY_STATUSES] },
            },
            select: { id: true },
          });
          if (clashes.length === 1 && clashes[0].id === appt.id) {
            candidates = [appt.barberId];
          }
        }
        if (candidates.length === 0) return { taken: true as const };

        const assigned = appt.barberId && candidates.includes(appt.barberId)
          ? appt.barberId
          : candidates[0];

        await tx.barberAppointment.update({
          where: { id: appt.id },
          data: { startAt, endAt, barberId: assigned },
        });
        // Los recordatorios ya encolados apuntaban a la hora vieja.
        await tx.barberMessage.updateMany({
          where: pendingReminderInvalidationWhere(ctx.shop.id, appt.id),
          data: reminderInvalidationData("MOVED"),
        });
        return { taken: false as const };
      },
      { maxWait: 10_000, timeout: 15_000 },
    );

    if (moved.taken) {
      const slots = await getPublicSlots({
        shop: { id: ctx.shop.id, timezone: ctx.shop.timezone },
        dateISO,
        durationMin,
        barberId: appt.barberId,
        now: ctx.now,
      }).catch(() => []);
      return {
        error: "ocupado",
        mensaje: "Ese horario ya está tomado. Ofrécele estas alternativas REALES.",
        alternativas: slots.map((s) => ({ hora: s.time, comoSeDice: humanTime(s.time) })),
      };
    }
  } catch (err) {
    if (isBarberOverlapError(err)) {
      return { error: "ocupado", mensaje: "Ese horario ya está tomado. Ofrécele otro." };
    }
    throw err;
  }

  ctx.effects.rescheduled.push(shortReference(appt.id));
  ctx.effects.summary.push(
    `🗓️ Tu cita se movió al ${humanDate(dateISO)} a las ${humanTime(time)}. ` +
      `Tu folio sigue siendo ${shortReference(appt.id)}.`,
  );
  return {
    ok: true,
    referencia: shortReference(appt.id),
    fechaBonita: humanDate(dateISO),
    horaBonita: humanTime(time),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   EL PROMPT
   ═══════════════════════════════════════════════════════════════════════ */

function buildSystemPrompt(ctx: ToolCtx): string {
  const s = ctx.settings;
  const shopName = ctx.shop.name;
  const botName = s.botName || shopName;
  const parts = getBarberTzParts(ctx.now, ctx.shop.timezone);
  const todayISO = barberTodayISO(ctx.shop.timezone, ctx.now);

  const address = [ctx.shop.address, ctx.shop.city, ctx.shop.state]
    .filter((x) => typeof x === "string" && x.trim())
    .join(", ");

  const tone =
    s.tone === "formal"
      ? "Tu registro es amable y correcto, sin frases hechas ni exceso de confianza."
      : "Tu registro es relajado y de barrio, como un barbero que ya te conoce. Nada forzado.";

  const lines: (string | null)[] = [
    `Eres ${botName}, quien contesta el WhatsApp de la barbería ${shopName}.`,
    tone,
    "",
    "CÓMO ESCRIBES:",
    "- Español de México, tuteando SIEMPRE. Nada de \"usted\", nada de voseo (\"vos\", \"tenés\", \"podés\").",
    "- Mensajes de WhatsApp: 1 a 3 frases. Sin markdown, sin listas numeradas largas, sin títulos.",
    "- La gente escribe desde el celular y con prisa. Ve al grano y haz UNA pregunta a la vez.",
    "- Nunca digas que eres una inteligencia artificial ni expliques cómo funcionas.",
    "",
    "🔴 LO MÁS IMPORTANTE — HORARIOS Y PRECIOS:",
    "- JAMÁS inventes un horario disponible. Los horarios SOLO salen de la herramienta buscar_horarios.",
    "- Si no llamaste a buscar_horarios, no tienes horarios: no digas ninguno, ni de ejemplo.",
    "- Los precios SOLO salen de listar_servicios. Nunca los adivines ni los recuerdes.",
    "- Antes de agendar necesitas: qué servicio, qué día, qué hora (de buscar_horarios) y su nombre.",
    "- Si el cliente pide algo que la barbería no ofrece, dilo claro y ofrece lo que sí hay.",
    "",
    "CUÁNDO PASAS LA CONVERSACIÓN A UNA PERSONA (pasar_con_persona):",
    "- Si te lo pide, aunque sea de mala manera.",
    "- Si se queja, reclama, o algo suena a problema.",
    "- Si preguntan algo que no está en tus datos y no lo puede resolver una herramienta.",
    "- Saludar, y todo lo de servicios, precios, horarios, ubicación y citas, lo atiendes tú con tus herramientas: eso no se pasa.",
    "- Vale más pasarla que inventar un dato.",
    "",
    "BOTONES:",
    "- Cuando le des a elegir entre opciones concretas (qué servicio, cuál de los horarios de buscar_horarios, un sí o no antes de agendar o cancelar), contesta con responder_con_opciones: el cliente toca un botón y no tiene que escribir.",
    "- Para una pregunta abierta (su nombre, qué día le queda) escribe normal, sin botones.",
    "- Lo que el cliente toca te llega como un mensaje con el título del botón.",
    "",
    "NOTAS DE VOZ:",
    "- Un mensaje que empieza con «🎤 Nota de voz:» o «🎵 Audio:» es la transcripción de un audio que mandó el cliente. Atiéndelo igual que si lo hubiera escrito.",
    "- Si la transcripción no se entiende, pídele que te lo repita o te lo escriba; no adivines.",
    "",
    `DATOS DE LA BARBERÍA (tu única fuente):`,
    `- Hoy es ${WEEKDAYS_ES[isoWeekday(todayISO)]} ${todayISO}, son las ${hhmm(parts.hour * 60 + parts.minute)} en la barbería.`,
    `- Para agendar usa fechas AAAA-MM-DD. "Mañana" es ${addIsoDays(todayISO, 1)}.`,
    address ? `- Dirección: ${address}` : null,
    ctx.shop.phone ? `- Teléfono: ${ctx.shop.phone}` : null,
    s.abilities.horarios ? `- Horario de la barbería: ${ctx.hoursText}` : null,
    ctx.barbers.length > 0
      ? `- Barberos: ${ctx.barbers.map((b) => `${b.name} (id ${b.id})`).join(", ")}`
      : null,
    s.notes ? `- Notas de la barbería: ${s.notes}` : null,
    "",
  ];

  if (ctx.client.name) {
    lines.push("EL CLIENTE:");
    lines.push(`- Se llama ${firstName(ctx.client.name)} y ya es cliente de la casa.`);
    lines.push(
      `- Salúdalo por su nombre con naturalidad la primera vez que le escribas en esta conversación.`,
    );
    if (ctx.client.usualServiceNames.length > 0) {
      const usual = ctx.client.usualServiceNames.join(" + ");
      const withWho = ctx.client.usualBarberName ? ` con ${ctx.client.usualBarberName}` : "";
      lines.push(
        `- La última vez se llevó ${usual}${withWho}. Si quiere "lo de siempre", eso es. ` +
          `Ofréceselo, pero confírmalo antes de agendar.`,
      );
      lines.push(
        `- Ids de "lo de siempre": servicios [${ctx.client.usualServiceIds.join(", ")}]` +
          (ctx.client.usualBarberId ? `, barbero ${ctx.client.usualBarberId}` : ""),
      );
    }
    lines.push("");
  } else {
    lines.push("EL CLIENTE:");
    lines.push("- No lo tenemos registrado. Pídele su nombre cuando vayas a agendar, no antes.");
    lines.push("");
  }

  const off = (Object.keys(s.abilities) as (keyof typeof s.abilities)[]).filter(
    (k) => !s.abilities[k],
  );
  if (off.length > 0) {
    lines.push(
      `LO QUE NO PUEDES HACER: ${off.join(", ")}. Si te lo piden, dilo con honestidad y usa pasar_con_persona.`,
    );
  }

  return lines.filter((l): l is string => l !== null).join("\n");
}

function firstName(name: string | null | undefined): string {
  const clean = (name ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.split(" ")[0];
}

/* ═══════════════════════════════════════════════════════════════════════
   LLAMADA AL MODELO — fetch directo, como el resto del repo
   (src/lib/integrations/claude.ts: sin SDK, x-api-key).
   ═══════════════════════════════════════════════════════════════════════ */

interface AiBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AiTurn {
  blocks: AiBlock[];
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
}

async function callClaude(args: {
  apiKey: string;
  model: string;
  system: string;
  messages: unknown[];
  tools: ToolDef[];
  /** true = última vuelta: tiene que cerrar con palabras, sin herramientas. */
  mustAnswer: boolean;
  signal: AbortSignal;
}): Promise<AiTurn> {
  const empty: AiTurn = {
    blocks: [],
    stopReason: null,
    inputTokens: 0,
    outputTokens: 0,
    error: null,
  };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Razonamiento y esfuerzo según el modelo (ver bot-core.ts).
        ...botModelRequestExtras(args.model, aiThinking()),
        system: args.system,
        messages: args.messages,
        ...(args.tools.length > 0 ? { tools: args.tools } : {}),
        // En la última vuelta las herramientas SIGUEN declaradas (el hilo ya
        // lleva bloques tool_use / tool_result que las nombran) pero se le
        // prohíbe pedir otra: `none` es la forma de decirlo sin quitarlas.
        ...(args.tools.length > 0 && args.mustAnswer ? { tool_choice: { type: "none" } } : {}),
      }),
      signal: args.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ...empty, error: `claude_${res.status}: ${body.slice(0, 180)}` };
    }

    const data = await res.json();
    return {
      blocks: Array.isArray(data?.content) ? (data.content as AiBlock[]) : [],
      stopReason: typeof data?.stop_reason === "string" ? data.stop_reason : null,
      inputTokens: Number(data?.usage?.input_tokens) || 0,
      outputTokens: Number(data?.usage?.output_tokens) || 0,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "fallo de red";
    return { ...empty, error: message };
  }
}

/** ¿Vale la pena reintentar UNA vez? Solo saturación o caída del proveedor. */
function isRetryableAiError(error: string | null): boolean {
  return /^claude_(429|500|502|503|529)\b/.test(error ?? "");
}

/* ═══════════════════════════════════════════════════════════════════════
   EL TURNO
   ═══════════════════════════════════════════════════════════════════════ */

export interface BarberBotTurnInput {
  barbershopId: string;
  phone: string;
  text: string;
  now?: Date;
  /**
   * Límite duro (epoch ms) que impone quien llama. La ingesta del webhook lo
   * usa para que turno + nota de voz quepan en el tiempo de la función.
   */
  deadlineAt?: number;
}

export interface BarberBotTurnResult {
  /** Lo que hay que mandarle al cliente. null = el bot no contesta. */
  reply: string | null;
  /**
   * Opciones para ofrecer con botones o lista junto a `reply`. [] = solo
   * texto. Quien manda (whatsapp.ts) decide botones (≤3) o lista (≤10) y cae
   * a texto si Meta lo rechaza.
   */
  options: BarberBotOption[];
  /** Por qué no contestó (o por qué pasó algo raro), para el panel. */
  skipped: BarberBotSkipReason | null;
  effects: BotEffects;
}

const NO_REPLY = (
  skipped: BarberBotSkipReason | null,
  effects?: BotEffects,
): BarberBotTurnResult => ({
  reply: null,
  options: [],
  skipped,
  effects: effects ?? emptyEffects(),
});

function emptyEffects(): BotEffects {
  return {
    booked: [],
    cancelled: [],
    rescheduled: [],
    handoff: false,
    handoffReason: null,
    summary: [],
    finalText: null,
    finalOptions: [],
  };
}

/* ── ¿El bot atiende este hilo ahora? ──────────────────────────────── */

interface BotGateState {
  /** Por qué el bot NO atiende este hilo ahora; null = lo atiende. */
  blocked: BarberBotSkipReason | null;
  /** Aunque el hilo esté abierto, puede no haber IA con qué contestar. */
  ai: "ok" | "aiUnavailable" | "aiCapReached";
  shop: BotShopRow | null;
  settings: BarberBotSettings;
  todayISO: string;
  /** Había una pausa del bot que ya caducó: hay que quitarla. */
  stalePause: boolean;
}

/**
 * Todas las puertas del bot, en orden y SIN efectos (no pausa, no contesta,
 * no gasta). Las usa el turno y también la ingesta, para saber si vale la
 * pena transcribir una nota de voz antes de pagarla.
 */
async function evaluateGate(shopId: string, phone: string, now: Date): Promise<BotGateState> {
  const { settings, storageReady } = await getBarberBotSettings(shopId);
  const state: BotGateState = {
    blocked: null,
    ai: "ok",
    shop: null,
    settings,
    todayISO: "",
    stalePause: false,
  };
  const block = (reason: BarberBotSkipReason): BotGateState => ({ ...state, blocked: reason });

  if (!storageReady) return block("storageMissing");
  if (!settings.enabled) return block("disabled");

  const shop = await loadBotShop(shopId);
  if (!shop || !shop.isActive) return block("disabled");
  state.shop = shop;

  // 🔴 EL CANDADO DEL PLAN, EN EL SERVIDOR. La pantalla puede mentir; esto
  // no. El bot es del plan Profesional. Plan y suscripción se leen de la
  // fila que PAGA (la matriz): una sucursal hereda los dos, igual que en
  // gating.ts y en los recordatorios.
  const payer = shop.parentId ? ((await loadBotShop(shop.parentId)) ?? shop) : shop;
  const plan = await getBarberPlan(payer.plan);
  if (!barberPlanHasFeature(plan, "whatsappBot")) return block("planLocked");
  if (!isBarbershopSubscriptionActive(payer)) return block("subscriptionInactive");

  const parts = getBarberTzParts(now, shop.timezone);
  const todayISO = barberTodayISO(shop.timezone, now);
  state.todayISO = todayISO;
  const inHours = botAnswersNow(
    settings.hours,
    isoWeekday(todayISO),
    parts.hour * 60 + parts.minute,
  );

  // ¿Este hilo lo atiende una persona? Una pausa que puso el bot caduca
  // sola (botPauseExpired); la de una persona, nunca.
  const pause = await readPause(shopId, phone);
  if (pause) {
    if (!botPauseExpired(pause, now, inHours)) return block("paused");
    state.stalePause = true;
  }

  if (!inHours) return block("offHours");

  // Cupo de mensajes del plan: si ya no hay, mandar la respuesta fallaría y
  // el cliente vería un silencio idéntico al de un bot roto. El panel lo dice.
  const quota = await getBarberWaQuota(shopId).catch(() => null);
  if (quota && quota.exhausted) return block("quotaExhausted");

  if (!aiApiKey()) return { ...state, ai: "aiUnavailable" };
  const capMicros = Math.max(0, settings.aiDailyCapMxn) * MICROS_PER_MXN;
  const spentMicros = await readSpendMicros(shopId, todayISO);
  if (capMicros <= 0 || spentMicros >= capMicros) return { ...state, ai: "aiCapReached" };

  return state;
}

/**
 * ¿El bot atendería AHORA un mensaje de este hilo usando IA? Sin efectos y
 * sin lanzar. `reason` dice por qué no.
 */
export async function barberBotGate(
  barbershopId: string,
  rawPhone: string,
  now: Date = new Date(),
): Promise<{ open: boolean; reason: BarberBotSkipReason | null }> {
  try {
    const phone = mxTenDigits(rawPhone);
    if (!phone) return { open: false, reason: "error" };
    const gate = await evaluateGate(requireShop(barbershopId), phone, now);
    if (gate.blocked) return { open: false, reason: gate.blocked };
    if (gate.ai !== "ok") return { open: false, reason: gate.ai };
    return { open: true, reason: null };
  } catch (err) {
    console.error("[barber/bot] no se pudo evaluar si el bot atiende:", err);
    return { open: false, reason: "error" };
  }
}

/**
 * Cobra la transcripción de una nota de voz contra el TOPE DIARIO de IA de
 * la barbería (barber_bot_usage), el mismo contador que las respuestas del
 * bot. En barber no hay saldo de IA aparte. Nunca lanza.
 */
export async function chargeBarberBotVoice(barbershopId: string, seconds: number): Promise<void> {
  try {
    const shop = await loadBotShop(requireShop(barbershopId));
    if (!shop) return;
    await addSpend(
      shop.id,
      barberTodayISO(shop.timezone),
      botVoiceCostMicros(seconds, usdMxn()),
      0,
    );
  } catch (err) {
    console.error("[barber/bot] no se pudo registrar el gasto de la nota de voz:", err);
  }
}

/**
 * PUNTO DE ENTRADA. Lo llama ingestBarberInbound (whatsapp.ts) cuando el
 * mensaje no era respuesta a un recordatorio.
 *
 * NUNCA lanza y NUNCA manda nada: devuelve el texto para que la capa de
 * WhatsApp lo mande con su propio camino (cupo, registro y estados
 * incluidos). Si devuelve reply=null, el cliente no recibe nada del bot y
 * el hilo se queda en el Inbox para una persona.
 */
export async function runBarberBotTurn(
  input: BarberBotTurnInput,
): Promise<BarberBotTurnResult> {
  try {
    return await runTurnInner(input);
  } catch (err) {
    console.error("[barber/bot] el turno falló:", err);
    return NO_REPLY("error");
  }
}

async function runTurnInner(input: BarberBotTurnInput): Promise<BarberBotTurnResult> {
  const shopId = requireShop(input.barbershopId);
  const phone = mxTenDigits(input.phone);
  const text = (input.text ?? "").trim();
  if (!phone || !text) return NO_REPLY(null);

  const now = input.now ?? new Date();
  // El presupuesto se mide con el reloj real aunque `now` venga inyectado.
  const deadline = Math.min(
    Date.now() + TURN_BUDGET_MS,
    input.deadlineAt ?? Number.POSITIVE_INFINITY,
  );

  // ── 1-4. Puertas: plan, suscripción, pausa, horario, cupo ─────────
  const gate = await evaluateGate(shopId, phone, now);
  if (gate.stalePause) {
    // La pausa del bot ya caducó y nadie tomó la conversación: vuelve.
    await resumeBarberBotThread({ barbershopId: shopId, phone });
  }
  if (gate.blocked === "offHours") {
    // No se queda callado: avisa UNA vez y deja el hilo marcado. La pausa
    // se quita sola en cuanto el bot vuelva a estar en horario.
    await pauseBarberBotThread({
      barbershopId: shopId,
      phone,
      reason: BARBER_BOT_PAUSE_OFF_HOURS,
      by: "bot",
    });
    return {
      reply:
        "¡Hola! Ahorita no estamos en línea. En cuanto abramos te contestamos por aquí. 🙏",
      options: [],
      skipped: "offHours",
      effects: emptyEffects(),
    };
  }
  if (gate.blocked || !gate.shop) return NO_REPLY(gate.blocked);

  const shop = gate.shop;
  const settings = gate.settings;
  const todayISO = gate.todayISO;

  // ── 5. "Quiero hablar con una persona" — antes de gastar en IA ────
  if (asksForHuman(text)) {
    await pauseBarberBotThread({
      barbershopId: shopId,
      phone,
      reason: "El cliente pidió hablar con una persona",
      by: "bot",
    });
    const effects = emptyEffects();
    effects.handoff = true;
    effects.handoffReason = "El cliente pidió hablar con una persona";
    return {
      reply:
        "Claro que sí. Ya le avisé a alguien de la barbería y te escribe en un momento por aquí. 🙌",
      options: [],
      skipped: "handoff",
      effects,
    };
  }

  // ── 6. ¿Hay IA con qué contestar? ─────────────────────────────────
  const apiKey = aiApiKey();
  const model = aiModel();
  if (gate.ai === "aiUnavailable" || !apiKey) return NO_REPLY("aiUnavailable");
  if (gate.ai === "aiCapReached") {
    // El tope frena a la IA, no al servicio: se contesta con la verdad y se
    // marca el hilo para que una persona lo tome.
    await pauseBarberBotThread({
      barbershopId: shopId,
      phone,
      reason: "Se alcanzó el tope de gasto de IA del día",
      by: "bot",
    });
    return {
      reply:
        "¡Hola! En un momento te atiende alguien de la barbería por aquí para agendarte. 🙏",
      options: [],
      skipped: "aiCapReached",
      effects: emptyEffects(),
    };
  }

  // ── 7. Contexto ───────────────────────────────────────────────────
  const [services, barbers, client, hoursText] = await Promise.all([
    loadServices(shopId),
    loadBarbers(shopId),
    loadClientInfo(shopId, phone),
    settings.abilities.horarios ? loadShopHours(shopId) : Promise.resolve(""),
  ]);

  const ctx: ToolCtx = {
    shop,
    phone,
    services,
    barbers,
    client,
    settings,
    now,
    effects: emptyEffects(),
    hoursText,
  };

  const history = await loadHistory(shopId, phone);
  // Sin nada del cliente, o con el equipo como último en hablar, no hay
  // pregunta que contestar (y la API exige que el último turno sea suyo).
  if (history.length === 0 || history[history.length - 1].role !== "user") {
    return NO_REPLY(null);
  }

  // ── 8. La conversación con el modelo ──────────────────────────────
  const tools = toolDefs(settings);
  const system = buildSystemPrompt(ctx);
  const messages: unknown[] = [...history];

  let costMicros = 0;
  let reply: string | null = null;
  let options: BarberBotOption[] = [];
  let aiFailed = false;

  const ask = async (mustAnswer: boolean): Promise<AiTurn> => {
    const left = deadline - Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(AI_CALL_TIMEOUT_MS, left));
    try {
      return await callClaude({
        apiKey,
        model,
        system,
        messages,
        tools,
        mustAnswer,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (deadline - Date.now() <= 1500) break;

    // En la última vuelta el modelo tiene que cerrar con palabras, no pedir
    // otra consulta que ya no cabe.
    const mustAnswer = round === MAX_TOOL_ROUNDS;
    let turn = await ask(mustAnswer);
    if (turn.error && isRetryableAiError(turn.error) && deadline - Date.now() > 5000) {
      // Saturación o caída momentánea del proveedor: UN reintento.
      await new Promise((resolve) => setTimeout(resolve, 700));
      turn = await ask(mustAnswer);
    }

    costMicros += botTurnCostMicros({
      model,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      usdMxn: usdMxn(),
    });

    if (turn.error) {
      console.error(`[barber/bot] Claude no respondió (${shopId}):`, turn.error);
      aiFailed = true;
      break;
    }

    const textOut = turn.blocks
      .filter((b) => b.type === "text")
      .map((b) => (b.text ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();

    const toolUses = turn.blocks.filter((b) => b.type === "tool_use");

    if (toolUses.length === 0 || turn.stopReason !== "tool_use") {
      reply = textOut || null;
      break;
    }

    // El bloque del asistente vuelve TAL CUAL (con sus tool_use y, si los
    // hay, sus bloques de razonamiento) o la API rechaza el tool_result.
    messages.push({ role: "assistant", content: turn.blocks });

    const results: unknown[] = [];
    for (const use of toolUses) {
      const out = await runTool(
        ctx,
        use.name ?? "",
        (use.input ?? {}) as Record<string, unknown>,
      );
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(out),
      });
    }
    // TODOS los tool_result en UN SOLO mensaje de usuario.
    messages.push({ role: "user", content: results });

    // responder_con_opciones ES la respuesta: el turno termina aquí, sin
    // gastar otra llamada para que el modelo diga lo mismo con palabras.
    if (ctx.effects.finalText) {
      reply = ctx.effects.finalText;
      options = ctx.effects.finalOptions;
      break;
    }
  }

  // ── 9. Cobrar el gasto y cerrar ───────────────────────────────────
  if (costMicros > 0) await addSpend(shopId, todayISO, costMicros);

  if (ctx.effects.handoff) {
    await pauseBarberBotThread({
      barbershopId: shopId,
      phone,
      reason: ctx.effects.handoffReason || "El bot pasó la conversación",
      by: "bot",
    });
  }

  if (!reply) {
    // 🔴 El modelo hizo algo REAL (agendó, canceló, movió) y no alcanzó a
    // decirlo: se le dice con las palabras que dejó la herramienta. Antes el
    // cliente recibía «te paso con alguien» con la cita ya creada.
    if (ctx.effects.summary.length > 0) {
      return {
        reply: ctx.effects.summary.join("\n"),
        options: [],
        skipped: null,
        effects: ctx.effects,
      };
    }
    // Sin respuesta utilizable, el cliente NO se queda atrapado: se le dice
    // la verdad y el hilo pasa a una persona.
    await pauseBarberBotThread({
      barbershopId: shopId,
      phone,
      reason: aiFailed ? "El bot no pudo responder" : "El bot no supo qué contestar",
      by: "bot",
    });
    return {
      reply:
        "Déjame paso esto con alguien de la barbería para no darte mal la información. Te escriben en un momento. 🙏",
      options: [],
      skipped: aiFailed ? "aiUnavailable" : "handoff",
      effects: ctx.effects,
    };
  }

  return {
    reply: reply.length > MAX_REPLY_CHARS ? `${reply.slice(0, MAX_REPLY_CHARS - 1)}…` : reply,
    options,
    skipped: ctx.effects.handoff ? "handoff" : null,
    effects: ctx.effects,
  };
}

/**
 * El hilo tal como lo verá el modelo.
 *
 * Se lee de BarberMessage (el Inbox real), así que el bot ve TAMBIÉN lo que
 * contestó una persona a mano: si el mostrador ya dijo algo, el bot no lo
 * contradice. El mensaje que dispara este turno ya está guardado por
 * ingestBarberInbound, así que la lista termina en él.
 *
 * Solo entra lo que el cliente de verdad LEYÓ: un saliente que Meta rechazó
 * (FAILED) o que sigue en cola (PENDING — el recordatorio de mañana) no es
 * algo que "dijimos", y metérselo al modelo como propio lo confunde.
 */
async function loadHistory(
  barbershopId: string,
  phone: string,
): Promise<{ role: string; content: string }[]> {
  const rows = await prisma.barberMessage.findMany({
    where: { barbershopId, phone },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY,
    select: { direction: true, body: true, status: true },
  });

  const ordered = rows.reverse();
  const out: { role: string; content: string }[] = [];
  for (const r of ordered) {
    const body = (r.body ?? "").trim();
    if (!body) continue;
    if (r.direction === "OUTBOUND" && (r.status === "FAILED" || r.status === "PENDING")) continue;
    const role = r.direction === "INBOUND" ? "user" : "assistant";
    const last = out[out.length - 1];
    // Turnos consecutivos del mismo lado se funden: la API pide alternancia.
    if (last && last.role === role) last.content += `\n${body}`;
    else out.push({ role, content: body });
  }
  // El primero tiene que ser del cliente.
  while (out.length > 0 && out[0].role === "assistant") out.shift();
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   LO QUE VE EL PANEL
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * El historial de lo que agendó el bot. No hace falta marcar los mensajes:
 * una cita del bot es una BarberAppointment con source = WHATSAPP, y eso ya
 * lo escribe la propia creación.
 */
export async function listBarberBotBookings(
  barbershopId: string,
  limit = 30,
): Promise<BarberBotBooking[]> {
  const shopId = requireShop(barbershopId);
  const rows = await prisma.barberAppointment.findMany({
    where: { barbershopId: shopId, source: "WHATSAPP" },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
    select: {
      id: true,
      startAt: true,
      status: true,
      clientName: true,
      clientPhone: true,
      createdAt: true,
      barber: { select: { name: true, nickname: true } },
      services: {
        select: { priceAtBooking: true, service: { select: { name: true } } },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    reference: shortReference(r.id),
    startAt: r.startAt.toISOString(),
    status: r.status,
    clientName: r.clientName,
    clientPhone: r.clientPhone,
    barberName: r.barber ? r.barber.nickname || r.barber.name : null,
    services: r.services.map((s) => s.service?.name ?? "").filter(Boolean),
    total: sumMoneyBy(r.services, (s) => s.priceAtBooking ?? 0),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getBarberBotPanelState(
  barbershopId: string,
  timezone: string,
): Promise<BarberBotPanelState> {
  const shopId = requireShop(barbershopId);
  const { settings, storageReady } = await getBarberBotSettings(shopId);

  const [spend, quota, pauses, bookings] = await Promise.all([
    getBarberBotSpend(shopId, timezone, settings.aiDailyCapMxn),
    getBarberWaQuota(shopId).catch(() => ({ used: 0, limit: 0 })),
    listBarberBotPauses(shopId),
    listBarberBotBookings(shopId).catch(() => []),
  ]);

  return {
    settings,
    storageReady,
    aiConfigured: aiApiKey() !== null,
    aiModel: aiModel(),
    spend,
    quota: {
      used: quota.used,
      limit: quota.limit,
      tight: quotaIsTight(quota.used, quota.limit),
    },
    pauses,
    bookings,
  };
}

/** ¿Esta barbería puede siquiera tener bot? Punto único del gate. */
export async function barbershopCanUseBot(barbershopId: string): Promise<boolean> {
  const shop = await loadBotShop(requireShop(barbershopId));
  if (!shop || !shop.isActive) return false;
  // El plan es el de quien paga: una sucursal hereda el de su matriz.
  const payer = shop.parentId ? ((await loadBotShop(shop.parentId)) ?? shop) : shop;
  const plan = await getBarberPlan(payer.plan);
  return barberPlanHasFeature(plan, "whatsappBot");
}
