/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — NÚCLEO PURO del bot de WhatsApp.

   Aquí NO se importa prisma ni "server-only": este módulo lo carga también
   el navegador (la pantalla de /barber/whatsapp/bot usa los mismos tipos y
   la misma normalización) y las pruebas lo ejecutan sin base de datos.
   Mismo reparto que booking-core / whatsapp-core / payments-core.

   Todo lo que decide algo y se puede probar sin BD vive aquí:
   normalización de la configuración, horario de atención, detección de
   "quiero hablar con una persona", y el costo estimado de un turno de IA.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Tono ──────────────────────────────────────────────────────────── */

/** Cómo habla el bot. El vertical tutea SIEMPRE; esto cambia el registro. */
export type BarberBotTone = "relajado" | "formal";

export const BARBER_BOT_TONES: BarberBotTone[] = ["relajado", "formal"];

export function isBarberBotTone(v: unknown): v is BarberBotTone {
  return v === "relajado" || v === "formal";
}

/* ── Qué puede hacer ───────────────────────────────────────────────── */

/**
 * Cada llave es una cosa que la barbería enciende o apaga. Apagar `agendar`
 * deja al bot como informador puro (precios, horarios, dirección) — hay
 * dueños que quieren exactamente eso al principio, hasta que le agarran
 * confianza.
 */
export const BARBER_BOT_ABILITY_KEYS = [
  "agendar",
  "cancelar",
  "reagendar",
  "precios",
  "horarios",
  "ubicacion",
] as const;

export type BarberBotAbility = (typeof BARBER_BOT_ABILITY_KEYS)[number];

export type BarberBotAbilities = Record<BarberBotAbility, boolean>;

export const DEFAULT_BARBER_BOT_ABILITIES: BarberBotAbilities = {
  agendar: true,
  cancelar: true,
  reagendar: true,
  precios: true,
  horarios: true,
  ubicacion: true,
};

/* ── Horario en el que contesta ────────────────────────────────────── */

/**
 * `always`  → contesta a cualquier hora (default: un bot que no contesta de
 *             noche desperdicia justo los mensajes que llegan de noche).
 * `custom`  → solo dentro de la ventana, y solo los días marcados.
 *
 * Fuera de horario el bot NO se queda callado: avisa que el equipo contesta
 * mañana y deja el hilo marcado. Un cliente ignorado se va con la
 * competencia; un cliente que sabe cuándo le responden, espera.
 */
export type BarberBotHoursMode = "always" | "custom";

export interface BarberBotHours {
  mode: BarberBotHoursMode;
  /** Minuto del día (0-1439) en la zona de la barbería. */
  startMinute: number;
  endMinute: number;
  /** Días activos, 0 = domingo … 6 = sábado. */
  days: number[];
}

export const DEFAULT_BARBER_BOT_HOURS: BarberBotHours = {
  mode: "always",
  startMinute: 9 * 60,
  endMinute: 21 * 60,
  days: [0, 1, 2, 3, 4, 5, 6],
};

/* ── Configuración completa ────────────────────────────────────────── */

export interface BarberBotSettings {
  enabled: boolean;
  tone: BarberBotTone;
  /** Cómo se presenta. Vacío = usa el nombre de la barbería. */
  botName: string;
  /** Datos extra que la barbería quiere que sepa (estacionamiento, etc.). */
  notes: string;
  abilities: BarberBotAbilities;
  hours: BarberBotHours;
  /** Tope de gasto de IA por DÍA y por barbería, en pesos. 0 = sin IA. */
  aiDailyCapMxn: number;
}

export const BARBER_BOT_AI_CAP_MIN = 0;
export const BARBER_BOT_AI_CAP_MAX = 500;
export const BARBER_BOT_AI_CAP_DEFAULT = 20;

/**
 * DEFAULT = APAGADO. Un bot que se enciende solo contestaría en nombre de
 * una barbería que nunca lo pidió, y eso no se deshace: el cliente ya leyó.
 */
export const DEFAULT_BARBER_BOT_SETTINGS: BarberBotSettings = {
  enabled: false,
  tone: "relajado",
  botName: "",
  notes: "",
  abilities: { ...DEFAULT_BARBER_BOT_ABILITIES },
  hours: { ...DEFAULT_BARBER_BOT_HOURS, days: [...DEFAULT_BARBER_BOT_HOURS.days] },
  aiDailyCapMxn: BARBER_BOT_AI_CAP_DEFAULT,
};

const NOTES_MAX = 1200;
const BOT_NAME_MAX = 40;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeAbilities(raw: unknown): BarberBotAbilities {
  const out = { ...DEFAULT_BARBER_BOT_ABILITIES };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const key of BARBER_BOT_ABILITY_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
  }
  // Reagendar sin poder agendar no significa nada: mover una cita es
  // elegir un hueco nuevo. Si `agendar` está apagado, se apagan los dos.
  if (!out.agendar) out.reagendar = false;
  return out;
}

function normalizeDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_BARBER_BOT_HOURS.days];
  const set = new Set<number>();
  for (const d of raw) {
    const n = typeof d === "number" ? d : Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  if (set.size === 0) return [];
  return Array.from(set).sort((a, b) => a - b);
}

function normalizeHours(raw: unknown): BarberBotHours {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_BARBER_BOT_HOURS, days: [...DEFAULT_BARBER_BOT_HOURS.days] };
  }
  const src = raw as Record<string, unknown>;
  const mode: BarberBotHoursMode = src.mode === "custom" ? "custom" : "always";
  const startMinute = clampInt(src.startMinute, 0, 1439, DEFAULT_BARBER_BOT_HOURS.startMinute);
  let endMinute = clampInt(src.endMinute, 0, 1440, DEFAULT_BARBER_BOT_HOURS.endMinute);
  // Una ventana invertida (21:00 → 09:00) dejaría al bot mudo todo el día
  // sin que nadie entienda por qué. Se corrige a "hasta el final del día".
  if (endMinute <= startMinute) endMinute = 1440;
  return { mode, startMinute, endMinute, days: normalizeDays(src.days) };
}

/**
 * Cualquier blob (de la BD o del navegador) → configuración válida.
 * NUNCA lanza: una configuración corrupta cae a los defaults, que dejan el
 * bot apagado.
 */
export function normalizeBotSettings(raw: unknown): BarberBotSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...DEFAULT_BARBER_BOT_SETTINGS,
      abilities: { ...DEFAULT_BARBER_BOT_ABILITIES },
      hours: { ...DEFAULT_BARBER_BOT_HOURS, days: [...DEFAULT_BARBER_BOT_HOURS.days] },
    };
  }
  const src = raw as Record<string, unknown>;
  return {
    enabled: src.enabled === true,
    tone: isBarberBotTone(src.tone) ? src.tone : DEFAULT_BARBER_BOT_SETTINGS.tone,
    botName: cleanText(src.botName, BOT_NAME_MAX),
    notes: typeof src.notes === "string" ? src.notes.trim().slice(0, NOTES_MAX) : "",
    abilities: normalizeAbilities(src.abilities),
    hours: normalizeHours(src.hours),
    aiDailyCapMxn: clampInt(
      src.aiDailyCapMxn,
      BARBER_BOT_AI_CAP_MIN,
      BARBER_BOT_AI_CAP_MAX,
      BARBER_BOT_AI_CAP_DEFAULT,
    ),
  };
}

/**
 * ¿El bot contesta AHORA?
 *
 * `minuteOfDay` y `weekday` vienen ya resueltos en la zona de la barbería
 * (quien llama usa getBarberTzParts): esta función es pura de verdad y no
 * conoce husos horarios.
 */
export function botAnswersNow(
  hours: BarberBotHours,
  weekday: number,
  minuteOfDay: number,
): boolean {
  if (hours.mode === "always") return true;
  if (!hours.days.includes(weekday)) return false;
  return minuteOfDay >= hours.startMinute && minuteOfDay < hours.endMinute;
}

/* ── "Quiero hablar con una persona" ───────────────────────────────── */

/**
 * Detección por reglas ANTES de gastar un peso en IA. No pretende ser
 * exhaustiva — el modelo también puede pedir el pase — pero cubre lo que la
 * gente escribe de verdad cuando ya se hartó del bot.
 */
// Un determinante suelto entre el verbo y la persona: en México se escribe
// "pásame con EL barbero" mucho más que "con UN barbero", y sin esto la
// frase más común de todas se colaba al modelo como si fuera una cita.
const DET = "(?:un[ao]?|el|la|los|las|mi|algun[ao]?)\\s+";
// A quién pide: incluye `alguien` ("pásame con alguien") y `barber`, que
// cubre "barbero" y "barbería" sin tocar "barba".
const QUIEN = "(?:persona|humano|alguien|asesor|encargad|due[ñn]|barber|staff)";

const HANDOFF_PATTERNS: RegExp[] = [
  new RegExp(`\\bhablar\\s+con\\s+(?:${DET})?${QUIEN}`, "i"),
  new RegExp(
    `\\b(?:p[aá]sa(?:r)?(?:me|nos)?|com[uú]nica(?:r)?(?:me|nos)?|transfier[eo]|transferir(?:me)?|quiero|necesito)\\s+` +
      `(?:con\\s+)?(?:${DET})?${QUIEN}`,
    "i",
  ),
  /\bpersona\s+real\b/i,
  /\bno\s+(quiero|me\s+sirve)\s+(hablar\s+con\s+)?(un\s+)?(bot|robot|m[aá]quina)/i,
  /\b(eres|es)\s+un\s+(bot|robot)\b/i,
  /\boperador[ae]?\b/i,
  /\bat(e|é)nci[oó]n\s+a\s+clientes?\b/i,
];

export function asksForHuman(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return HANDOFF_PATTERNS.some((re) => re.test(t));
}

/* ── Costo de la IA ────────────────────────────────────────────────── */

/**
 * Precio del modelo en dólares por millón de tokens. Se usa SOLO para
 * estimar el gasto y respetar el tope diario; no es una factura.
 *
 * Si el modelo se cambia por env a uno que no esté aquí, se cobra con la
 * tarifa más CARA de la tabla: preferimos frenar de más que gastar de más.
 */
export interface BarberBotModelPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

export const BARBER_BOT_MODEL_PRICES: Record<string, BarberBotModelPrice> = {
  "claude-haiku-4-5": { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
  "claude-sonnet-4-6": { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  "claude-sonnet-5": { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  "claude-opus-5": { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
};

const MOST_EXPENSIVE: BarberBotModelPrice = { inputPerMTokUsd: 5, outputPerMTokUsd: 25 };

export function botModelPrice(model: string): BarberBotModelPrice {
  return BARBER_BOT_MODEL_PRICES[model] ?? MOST_EXPENSIVE;
}

/**
 * Tipo de cambio para convertir el costo (que Anthropic cobra en dólares) al
 * peso en que la barbería fija su tope. Es una CONSTANTE de referencia, no
 * una cotización: se puede mover con BARBER_BOT_USD_MXN sin redeploy del
 * código. Un tipo de cambio desfasado mueve el tope, nunca la factura real.
 */
export const BARBER_BOT_USD_MXN_FALLBACK = 18;

/** 1 peso = 1e6 micros. Un turno cuesta fracciones de centavo. */
export const MICROS_PER_MXN = 1_000_000;

/**
 * Costo estimado de un turno, en micros de peso.
 *
 * Se redondea HACIA ARRIBA: mil turnos que redondearan a la baja regalarían
 * un pedazo del tope, y el tope es justo lo que protege a la barbería.
 */
export function botTurnCostMicros(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  usdMxn: number;
}): number {
  const price = botModelPrice(args.model);
  const inTok = Math.max(0, args.inputTokens || 0);
  const outTok = Math.max(0, args.outputTokens || 0);
  const usd =
    (inTok / 1_000_000) * price.inputPerMTokUsd + (outTok / 1_000_000) * price.outputPerMTokUsd;
  const rate = args.usdMxn > 0 ? args.usdMxn : BARBER_BOT_USD_MXN_FALLBACK;
  return Math.ceil(usd * rate * MICROS_PER_MXN);
}

/** Micros → pesos con 2 decimales, para enseñarlo en el panel. */
export function microsToMxn(micros: number): number {
  return Math.round((micros / MICROS_PER_MXN) * 100) / 100;
}

/* ── Estado del cupo de mensajes ───────────────────────────────────── */

/**
 * Cuándo avisar en el panel que el cupo de WhatsApp se está acabando. No
 * corta nada: solo pinta el aviso. El corte real lo decide el envío.
 */
export const BARBER_BOT_QUOTA_WARN_RATIO = 0.85;

export function quotaIsTight(used: number, limit: number): boolean {
  if (limit < 0) return false; // -1 = ilimitado
  if (limit === 0) return true;
  return used / limit >= BARBER_BOT_QUOTA_WARN_RATIO;
}

/* ── Lo que el panel recibe (client-safe, sin prisma) ───────────────── */

/** Una conversación que atiende una persona, no el bot. */
export interface BarberBotPause {
  phone: string;
  reason: string | null;
  pausedAt: string;
}

/** Gasto de IA del día contra el tope de la barbería. */
export interface BarberBotSpend {
  day: string;
  spentMxn: number;
  capMxn: number;
  turns: number;
  /** true = hoy ya no se llama al modelo. */
  capReached: boolean;
}

/** Una cita que cerró el bot (BarberAppointment con source WHATSAPP). */
export interface BarberBotBooking {
  id: string;
  reference: string;
  startAt: string;
  status: string;
  clientName: string | null;
  clientPhone: string | null;
  barberName: string | null;
  services: string[];
  total: number;
  createdAt: string;
}

/** Todo lo que pinta /barber/whatsapp/bot. */
export interface BarberBotPanelState {
  settings: BarberBotSettings;
  /** false = falta correr sql/barber_bot.sql. */
  storageReady: boolean;
  /** false = no hay llave de IA configurada en el entorno. */
  aiConfigured: boolean;
  aiModel: string;
  spend: BarberBotSpend;
  quota: { used: number; limit: number; tight: boolean };
  pauses: BarberBotPause[];
  bookings: BarberBotBooking[];
}

/* ── Motivos por los que el bot NO contestó ────────────────────────── */

/**
 * Se registran para que el panel pueda explicar el silencio. "No contestó"
 * sin motivo es lo que hace que un dueño desconfíe del bot y lo apague.
 */
export type BarberBotSkipReason =
  | "disabled"
  | "planLocked"
  | "subscriptionInactive"
  | "notConnected"
  | "storageMissing"
  | "paused"
  | "offHours"
  | "quotaExhausted"
  | "handoff"
  | "aiCapReached"
  | "aiUnavailable"
  | "error";

export const BARBER_BOT_SKIP_LABELS: Record<BarberBotSkipReason, string> = {
  disabled: "El bot está apagado.",
  planLocked: "El bot es del plan Profesional.",
  subscriptionInactive: "La suscripción no está activa.",
  notConnected: "La barbería no tiene WhatsApp conectado.",
  storageMissing: "Falta aplicar sql/barber_bot.sql.",
  paused: "Esta conversación la atiende una persona.",
  offHours: "Llegó fuera del horario del bot.",
  quotaExhausted: "Se acabó el cupo de mensajes del plan.",
  handoff: "El cliente pidió hablar con una persona.",
  aiCapReached: "Se alcanzó el tope de gasto de IA del día.",
  aiUnavailable: "La IA no está configurada o no respondió.",
  error: "Hubo un error al procesar el mensaje.",
};
