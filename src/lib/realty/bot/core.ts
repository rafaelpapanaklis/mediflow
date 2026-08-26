/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — NÚCLEO PURO del bot de WhatsApp.

   Aquí NO se importa prisma ni "server-only": este módulo lo carga también
   el navegador (la pantalla de /inmobiliaria/bot usa los mismos tipos y la
   misma normalización) y las pruebas lo ejecutan sin base de datos. Mismo
   reparto que whatsapp-core / plan-shared / properties-shared del vertical,
   y que bot-core.ts de barber.

   Todo lo que DECIDE algo y se puede probar sin BD vive aquí: normalización
   de la configuración, horario, detección de "quiero hablar con una
   persona", el costo estimado de un turno y el tope de gasto.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Tono ──────────────────────────────────────────────────────────── */

/** Cómo habla el bot. El vertical tutea SIEMPRE; esto cambia el registro. */
export type RealtyBotTone = "cercano" | "formal";

export const REALTY_BOT_TONES: RealtyBotTone[] = ["cercano", "formal"];

export function isRealtyBotTone(v: unknown): v is RealtyBotTone {
  return v === "cercano" || v === "formal";
}

/* ── Qué puede hacer ───────────────────────────────────────────────── */

/**
 * Cada llave es una cosa que la inmobiliaria enciende o apaga. Apagar
 * `agendar` deja al bot como informador puro (precio, zona, recámaras) —
 * hay dueños que quieren exactamente eso hasta que le agarran confianza.
 */
export const REALTY_BOT_ABILITY_KEYS = [
  "precio",
  "ubicacion",
  "caracteristicas",
  "agendar",
  "calificar",
] as const;

export type RealtyBotAbility = (typeof REALTY_BOT_ABILITY_KEYS)[number];

export type RealtyBotAbilities = Record<RealtyBotAbility, boolean>;

export const DEFAULT_REALTY_BOT_ABILITIES: RealtyBotAbilities = {
  precio: true,
  ubicacion: true,
  caracteristicas: true,
  agendar: true,
  calificar: true,
};

export const REALTY_BOT_ABILITY_LABELS: Record<RealtyBotAbility, string> = {
  precio: "Decir el precio",
  ubicacion: "Decir la zona (nunca la dirección exacta)",
  caracteristicas: "Recámaras, baños, metros y amenidades",
  agendar: "Agendar la visita",
  calificar: "Preguntar presupuesto y tipo de crédito",
};

/* ── Horario en el que contesta ────────────────────────────────────── */

/**
 * `always` → contesta a cualquier hora. Es el default a propósito: en
 * bienes raíces gana quien contesta primero, y los prospectos escriben de
 * noche justo cuando nadie del equipo está.
 *
 * Fuera de horario el bot NO se queda mudo: avisa cuándo le contestan y
 * marca el hilo. Un prospecto ignorado se va con la competencia.
 */
export type RealtyBotHoursMode = "always" | "custom";

export interface RealtyBotHours {
  mode: RealtyBotHoursMode;
  /** Minuto del día (0-1439) en la zona de la cuenta. */
  startMinute: number;
  endMinute: number;
  /** Días activos, 0 = domingo … 6 = sábado. */
  days: number[];
}

export const DEFAULT_REALTY_BOT_HOURS: RealtyBotHours = {
  mode: "always",
  startMinute: 9 * 60,
  endMinute: 21 * 60,
  days: [0, 1, 2, 3, 4, 5, 6],
};

/* ── Configuración completa ────────────────────────────────────────── */

export interface RealtyBotSettings {
  enabled: boolean;
  tone: RealtyBotTone;
  /** Cómo se presenta. Vacío = usa el nombre de la inmobiliaria. */
  botName: string;
  /** Datos extra que la cuenta quiere que sepa (formas de pago, etc.). */
  notes: string;
  abilities: RealtyBotAbilities;
  hours: RealtyBotHours;
  /** Tope de gasto de IA por DÍA y por cuenta, en pesos. 0 = sin IA. */
  aiDailyCapMxn: number;
  /** Cuántas veces contesta al MISMO teléfono en un día. */
  maxRepliesPerContactPerDay: number;
}

export const REALTY_BOT_AI_CAP_MIN = 0;
/**
 * 🔴 NO EXISTE "ILIMITADO". El tope es un entero acotado, y la base lo
 * repite con un CHECK (realty_bot_cap_bounded en sql/realty_growth.sql).
 * Si alguien escribe 10 000 en el JSON, aquí se recorta a 500 y allá se
 * rechaza: no hay camino a un bot encendido con gasto abierto.
 */
export const REALTY_BOT_AI_CAP_MAX = 500;
export const REALTY_BOT_AI_CAP_DEFAULT = 20;

export const REALTY_BOT_REPLIES_MIN = 1;
export const REALTY_BOT_REPLIES_MAX = 40;
export const REALTY_BOT_REPLIES_DEFAULT = 12;

/**
 * DEFAULT = APAGADO. Un bot que se enciende solo contestaría en nombre de
 * una inmobiliaria que nunca lo pidió, y eso no se deshace: el prospecto ya
 * leyó. Nace apagado y CON tope — nunca apagado y sin tope, porque entonces
 * el primer encendido sería el que decide cuánto se gasta.
 */
export const DEFAULT_REALTY_BOT_SETTINGS: RealtyBotSettings = {
  enabled: false,
  tone: "cercano",
  botName: "",
  notes: "",
  abilities: { ...DEFAULT_REALTY_BOT_ABILITIES },
  hours: { ...DEFAULT_REALTY_BOT_HOURS, days: [...DEFAULT_REALTY_BOT_HOURS.days] },
  aiDailyCapMxn: REALTY_BOT_AI_CAP_DEFAULT,
  maxRepliesPerContactPerDay: REALTY_BOT_REPLIES_DEFAULT,
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

function normalizeAbilities(raw: unknown): RealtyBotAbilities {
  const out = { ...DEFAULT_REALTY_BOT_ABILITIES };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;
  for (const key of REALTY_BOT_ABILITY_KEYS) {
    if (typeof src[key] === "boolean") out[key] = src[key] as boolean;
  }
  return out;
}

function normalizeDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REALTY_BOT_HOURS.days];
  const set = new Set<number>();
  for (const d of raw) {
    const n = typeof d === "number" ? d : Number(d);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  if (set.size === 0) return [];
  return Array.from(set).sort((a, b) => a - b);
}

function normalizeHours(raw: unknown): RealtyBotHours {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_REALTY_BOT_HOURS, days: [...DEFAULT_REALTY_BOT_HOURS.days] };
  }
  const src = raw as Record<string, unknown>;
  const mode: RealtyBotHoursMode = src.mode === "custom" ? "custom" : "always";
  const startMinute = clampInt(src.startMinute, 0, 1439, DEFAULT_REALTY_BOT_HOURS.startMinute);
  let endMinute = clampInt(src.endMinute, 0, 1440, DEFAULT_REALTY_BOT_HOURS.endMinute);
  // Una ventana invertida (21:00 → 09:00) dejaría al bot mudo todo el día
  // sin que nadie entienda por qué. Se corrige a "hasta el fin del día".
  if (endMinute <= startMinute) endMinute = 1440;
  return { mode, startMinute, endMinute, days: normalizeDays(src.days) };
}

/**
 * Cualquier blob (de la BD o del navegador) → configuración válida.
 * NUNCA lanza: una configuración corrupta cae a los defaults, que dejan el
 * bot APAGADO y con tope.
 */
export function normalizeRealtyBotSettings(raw: unknown): RealtyBotSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ...DEFAULT_REALTY_BOT_SETTINGS,
      abilities: { ...DEFAULT_REALTY_BOT_ABILITIES },
      hours: { ...DEFAULT_REALTY_BOT_HOURS, days: [...DEFAULT_REALTY_BOT_HOURS.days] },
    };
  }
  const src = raw as Record<string, unknown>;
  return {
    // `=== true` y no un truthy: un "false" de texto, un 1 o un objeto
    // corrupto NO pueden encender el bot.
    enabled: src.enabled === true,
    tone: isRealtyBotTone(src.tone) ? src.tone : DEFAULT_REALTY_BOT_SETTINGS.tone,
    botName: cleanText(src.botName, BOT_NAME_MAX),
    notes: typeof src.notes === "string" ? src.notes.trim().slice(0, NOTES_MAX) : "",
    abilities: normalizeAbilities(src.abilities),
    hours: normalizeHours(src.hours),
    aiDailyCapMxn: clampInt(
      src.aiDailyCapMxn,
      REALTY_BOT_AI_CAP_MIN,
      REALTY_BOT_AI_CAP_MAX,
      REALTY_BOT_AI_CAP_DEFAULT,
    ),
    maxRepliesPerContactPerDay: clampInt(
      src.maxRepliesPerContactPerDay,
      REALTY_BOT_REPLIES_MIN,
      REALTY_BOT_REPLIES_MAX,
      REALTY_BOT_REPLIES_DEFAULT,
    ),
  };
}

/**
 * ¿El bot contesta AHORA?
 *
 * `minuteOfDay` y `weekday` vienen ya resueltos en la zona de la cuenta
 * (quien llama usa startOfDayInTz/Intl): esta función es pura de verdad y
 * no conoce husos horarios.
 */
export function realtyBotAnswersNow(
  hours: RealtyBotHours,
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
 * exhaustiva — el modelo también puede pedir el pase con su herramienta —
 * pero cubre lo que la gente escribe de verdad cuando ya se hartó del bot.
 *
 * 🔴 Y SIEMPRE gana: si esto da true, no se llama al modelo.
 */
const DET = "(?:un[ao]?|el|la|los|las|mi|algun[ao]?)\\s+";
// A quién pide. `asesor` y `agente` son las dos palabras que de verdad usa
// alguien que busca casa; `alguien` cubre "pásame con alguien".
const QUIEN =
  "(?:persona|humano|alguien|asesor|agente|vendedor|encargad|due[ñn]|corredor|broker|ejecutiv)";

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
  // En bienes raíces esto SIEMPRE es para una persona: son las tres
  // preguntas donde una respuesta inventada cuesta una demanda.
  /\bme\s+puedes?\s+(llamar|marcar)\b/i,
];

export function realtyBotAsksForHuman(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return HANDOFF_PATTERNS.some((re) => re.test(t));
}

/* ── Costo de la IA ────────────────────────────────────────────────── */

/**
 * Precio del modelo en dólares por millón de tokens. Se usa SOLO para
 * estimar el gasto y respetar el tope diario; no es una factura.
 *
 * Tarifas de la API de Anthropic verificadas el 2026-08-25. Si el modelo se
 * cambia por env a uno que no esté aquí, se cobra con la tarifa más CARA de
 * la tabla: preferimos frenar de más que gastar de más.
 */
export interface RealtyBotModelPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
}

export const REALTY_BOT_MODEL_PRICES: Record<string, RealtyBotModelPrice> = {
  "claude-haiku-4-5": { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
  "claude-haiku-4-5-20251001": { inputPerMTokUsd: 1, outputPerMTokUsd: 5 },
  "claude-sonnet-4-6": { inputPerMTokUsd: 3, outputPerMTokUsd: 15 },
  "claude-sonnet-5": { inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
  "claude-opus-5": { inputPerMTokUsd: 5, outputPerMTokUsd: 25 },
  "claude-fable-5": { inputPerMTokUsd: 10, outputPerMTokUsd: 50 },
};

const MOST_EXPENSIVE: RealtyBotModelPrice = { inputPerMTokUsd: 10, outputPerMTokUsd: 50 };

export function realtyBotModelPrice(model: string): RealtyBotModelPrice {
  return REALTY_BOT_MODEL_PRICES[model] ?? MOST_EXPENSIVE;
}

/**
 * Tipo de cambio para convertir el costo (que Anthropic cobra en dólares)
 * al peso en que la inmobiliaria fija su tope. Es una CONSTANTE de
 * referencia, no una cotización: se mueve con REALTY_BOT_USD_MXN sin
 * redeploy. Un tipo de cambio desfasado mueve el TOPE, nunca la factura.
 */
export const REALTY_BOT_USD_MXN_FALLBACK = 18;

/** 1 peso = 1e6 micros. Un turno cuesta fracciones de centavo. */
export const MICROS_PER_MXN = 1_000_000;

/**
 * Costo estimado de un turno, en micros de peso.
 *
 * Se redondea HACIA ARRIBA: mil turnos que redondearan a la baja regalarían
 * un pedazo del tope, y el tope es justo lo que protege a la cuenta.
 */
export function realtyBotTurnCostMicros(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  usdMxn: number;
}): number {
  const price = realtyBotModelPrice(args.model);
  const inTok = Math.max(0, args.inputTokens || 0);
  const outTok = Math.max(0, args.outputTokens || 0);
  const usd =
    (inTok / 1_000_000) * price.inputPerMTokUsd + (outTok / 1_000_000) * price.outputPerMTokUsd;
  const rate = args.usdMxn > 0 ? args.usdMxn : REALTY_BOT_USD_MXN_FALLBACK;
  return Math.ceil(usd * rate * MICROS_PER_MXN);
}

/** Micros → pesos con 2 decimales, para enseñarlo en el panel. */
export function realtyMicrosToMxn(micros: number): number {
  return Math.round((micros / MICROS_PER_MXN) * 100) / 100;
}

/**
 * ⭐ LA PUERTA DEL DINERO, en una función pura y probable sin BD.
 *
 * Devuelve true SOLO si el bot puede llamar al modelo. Un tope de 0 (o
 * negativo, o NaN) NUNCA deja pasar: no hay valor de `cap` que signifique
 * "ilimitado". Quien llame al modelo sin pasar por aquí se está saltando el
 * tope, y eso es lo único que hay que revisar en un code review.
 */
export function realtyBotCanSpend(spentMicros: number, capMxn: number): boolean {
  const cap = Number.isFinite(capMxn) ? Math.floor(capMxn) : 0;
  if (cap <= 0) return false;
  const capMicros = Math.min(cap, REALTY_BOT_AI_CAP_MAX) * MICROS_PER_MXN;
  const spent = Number.isFinite(spentMicros) && spentMicros > 0 ? spentMicros : 0;
  return spent < capMicros;
}

/* ── Estado del cupo de mensajes del plan ──────────────────────────── */

/** Cuándo AVISAR en el panel que el cupo de WhatsApp se acaba. No corta. */
export const REALTY_BOT_QUOTA_WARN_RATIO = 0.85;

export function realtyQuotaIsTight(used: number, limit: number): boolean {
  if (limit < 0) return false; // -1 = ilimitado
  if (limit === 0) return true;
  return used / limit >= REALTY_BOT_QUOTA_WARN_RATIO;
}

/* ── Motivos por los que el bot NO contestó ────────────────────────── */

/**
 * Se registran para que el panel pueda explicar el silencio. "No contestó"
 * sin motivo es lo que hace que un dueño desconfíe del bot y lo apague.
 */
export type RealtyBotSkipReason =
  | "disabled"
  | "planLocked"
  | "subscriptionInactive"
  | "notConnected"
  | "storageMissing"
  | "paused"
  | "offHours"
  | "quotaExhausted"
  | "optedOut"
  | "tooManyReplies"
  | "handoff"
  | "aiCapReached"
  | "aiUnavailable"
  | "windowClosed"
  | "error";

export const REALTY_BOT_SKIP_LABELS: Record<RealtyBotSkipReason, string> = {
  disabled: "El bot está apagado.",
  planLocked: "El bot viene con el Inbox de WhatsApp.",
  subscriptionInactive: "La suscripción no está al corriente.",
  notConnected: "La cuenta no tiene WhatsApp conectado.",
  storageMissing: "Falta aplicar sql/realty_growth.sql.",
  paused: "Esta conversación la atiende una persona.",
  offHours: "Llegó fuera del horario del bot.",
  quotaExhausted: "Se acabó el cupo de mensajes del plan.",
  optedOut: "Esta persona pidió no recibir mensajes.",
  tooManyReplies: "Ya se le contestó muchas veces hoy a este número.",
  handoff: "El prospecto pidió hablar con una persona.",
  aiCapReached: "Se alcanzó el tope de gasto de IA del día.",
  aiUnavailable: "La IA no está configurada o no respondió.",
  windowClosed: "Pasaron más de 24 h desde su último mensaje.",
  error: "Hubo un error al procesar el mensaje.",
};

/* ── Lo que el panel recibe (client-safe, sin prisma) ───────────────── */

/** Una conversación que atiende una persona, no el bot. */
export interface RealtyBotPauseDTO {
  phone: string;
  reason: string | null;
  pausedAt: string;
}

/** Gasto de IA del día contra el tope de la cuenta. */
export interface RealtyBotSpendDTO {
  day: string;
  spentMxn: number;
  capMxn: number;
  turns: number;
  /** true = hoy ya no se llama al modelo. */
  capReached: boolean;
}

/** Un turno del bot, para la pantalla "qué contestó". */
export interface RealtyBotTurnDTO {
  id: string;
  phone: string;
  contactName: string | null;
  inboundBody: string | null;
  outboundBody: string | null;
  skipReason: RealtyBotSkipReason | null;
  handoff: boolean;
  handoffReason: string | null;
  costMxn: number;
  correctedBody: string | null;
  correctedAt: string | null;
  createdAt: string;
}

/** Todo lo que pinta /inmobiliaria/bot. */
export interface RealtyBotPanelState {
  settings: RealtyBotSettings;
  /** false = falta correr sql/realty_growth.sql. */
  storageReady: boolean;
  /** false = no hay llave de IA en el entorno. */
  aiConfigured: boolean;
  aiModel: string;
  spend: RealtyBotSpendDTO;
  quota: { used: number; limit: number; tight: boolean };
  pauses: RealtyBotPauseDTO[];
  turns: RealtyBotTurnDTO[];
  /** Visitas que agendó el bot (RealtyVisit creadas por él). */
  visits: {
    id: string;
    propertyTitle: string;
    contactName: string | null;
    scheduledAt: string;
    status: string;
  }[];
}

/* ── Errores de la base cuando falta el SQL ────────────────────────── */

/**
 * ¿Este error es "la tabla no existe todavía"? PURA: solo mira la forma del
 * error, no toca la base.
 *
 * Los códigos cambian de forma según por dónde entre la consulta (ver la
 * nota de db-errors.ts de barber): en RAW sale un P2010 de Prisma con el
 * SQLSTATE de Postgres dentro de `meta.code` (42P01 tabla / 42703 columna);
 * por el cliente tipado salen P2021 (tabla) y P2022 (columna). Se reconocen
 * los cuatro porque este módulo usa los dos caminos.
 */
export function isMissingRealtyGrowthTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; meta?: unknown; message?: unknown };
  if (e.code === "P2021" || e.code === "P2022") return true;
  if (e.code === "P2010") {
    const meta = (e.meta ?? {}) as { code?: unknown };
    if (meta.code === "42P01" || meta.code === "42703") return true;
  }
  const msg = typeof e.message === "string" ? e.message : "";
  return /relation .* does not exist|does not exist in the current database/i.test(msg);
}
