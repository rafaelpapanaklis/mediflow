import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { mxTenDigits } from "@/lib/phone-mx";
import {
  BARBER_FILES_BUCKET,
  type BarberClientDTO,
  type BarberPhotoKind,
  type BarberVisitPhotoDTO,
} from "@/lib/barber/types";
import type { BarberContext } from "@/lib/barber-auth";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — capa de datos del módulo de CLIENTES (T4).
 *
 * TERMINOLOGÍA: cliente / barbero / barbería / servicio / visita — el
 * catálogo es BARBER_TERMS en types.ts, y la lista de palabras vetadas está
 * en la cabecera de ese mismo archivo. Aquí lo que hay es HISTORIAL DE CORTES.
 *
 * ── AISLAMIENTO MULTI-TENANT (la regla que no se rompe) ──────────────
 * TODAS las funciones reciben el `BarberContext` de getBarberContext() y
 * filtran por `ctx.barbershopId`. NINGUNA acepta un barbershopId por
 * parámetro suelto, precisamente para que no exista la forma de colarlo
 * desde el body/query. Ojo Prisma: un `barbershopId: undefined` BORRA el
 * filtro — por eso el where se arma con el string ya desestructurado.
 *
 * Alcance = LA SEDE de la sesión, no la cadena. No se usa
 * getAccessibleBranchIds() a propósito: `barber_clients` tiene ÚNICO
 * (barbershopId, phone), o sea que el mismo señor en dos sucursales son
 * dos filas distintas, y una vista "de la cadena" mostraría duplicados con
 * contadores de lealtad distintos. Si la ola multisucursal quiere una
 * agenda de clientes compartida, ese es un cambio de modelo, no un cambio
 * de filtro. Este módulo elige el alcance MÁS ESTRECHO.
 *
 * ── DÓNDE VIVE CADA COSA ────────────────────────────────────────────
 * · Ficha, preferencias, bloqueo, fotos, listas de cumpleaños/inactivos
 *   y config de la barbería  →  este archivo.
 * · Contador de lealtad (derivado, no manipulable) → barber/loyalty.ts.
 *
 * ── CONFIG POR BARBERÍA SIN TOCAR EL SCHEMA ─────────────────────────
 * `loyaltyThreshold` / `inactiveDays` viven como columnas sueltas de
 * `barber_shops` creadas por sql/barber_clientes.sql y se leen con SQL
 * parametrizado (el cliente Prisma no las conoce). Si el SQL no está
 * aplicado, la lectura atrapa el 42703 y cae a los defaults: el módulo
 * funciona igual, solo que los números no se pueden editar.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Config de la barbería ──────────────────────────────────────────────

export interface BarberClientsConfig {
  loyaltyEnabled: boolean;
  /** Cada cuántas visitas se gana el premio. */
  loyaltyThreshold: number;
  /** Etiqueta del premio. Nunca null hacia afuera. */
  loyaltyReward: string;
  /** Días sin visita para entrar a la lista de inactivos. */
  inactiveDays: number;
  /** false = sql/barber_clientes.sql aún no aplicado (config no editable). */
  persisted: boolean;
}

export const BARBER_CLIENTS_CONFIG_DEFAULTS = {
  loyaltyEnabled: true,
  loyaltyThreshold: 10,
  loyaltyReward: "Corte gratis",
  inactiveDays: 60,
} as const;

export const LOYALTY_THRESHOLD_MIN = 1;
export const LOYALTY_THRESHOLD_MAX = 100;
export const INACTIVE_DAYS_MIN = 7;
export const INACTIVE_DAYS_MAX = 730;

/**
 * Recuerda, por proceso, que las columnas de config no existen todavía.
 * Sin esto cada render volvería a pegarle a Postgres para recibir el mismo
 * 42703. Se limpia sola al reiniciar el runtime (que es justo cuando puede
 * haber cambiado el estado del SQL en un deploy).
 */
let configColumnsMissing = false;

function isMissingColumnError(e: unknown): boolean {
  // 42703 = undefined_column. Prisma lo envuelve en P2010 (raw query failed)
  // y deja el código nativo en meta.code, pero según la versión también
  // aparece solo en el mensaje: se comprueban las dos formas.
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = e.meta as { code?: unknown } | undefined;
    if (meta && String(meta.code) === "42703") return true;
  }
  return e instanceof Error && /42703|does not exist|no existe la columna/i.test(e.message);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Config viva de la barbería (o los defaults si el SQL está pendiente). */
export async function getBarberClientsConfig(ctx: BarberContext): Promise<BarberClientsConfig> {
  const fallback: BarberClientsConfig = { ...BARBER_CLIENTS_CONFIG_DEFAULTS, persisted: false };
  if (configColumnsMissing) return fallback;

  const barbershopId = ctx.barbershopId;
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        loyaltyEnabled: boolean;
        loyaltyThreshold: number;
        loyaltyReward: string | null;
        inactiveDays: number;
      }>
    >`
      SELECT "loyaltyEnabled", "loyaltyThreshold", "loyaltyReward", "inactiveDays"
      FROM "barber_shops"
      WHERE "id" = ${barbershopId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return fallback;
    const reward = (row.loyaltyReward ?? "").trim();
    return {
      loyaltyEnabled: row.loyaltyEnabled !== false,
      loyaltyThreshold: clampInt(
        row.loyaltyThreshold,
        LOYALTY_THRESHOLD_MIN,
        LOYALTY_THRESHOLD_MAX,
        BARBER_CLIENTS_CONFIG_DEFAULTS.loyaltyThreshold,
      ),
      loyaltyReward: reward || BARBER_CLIENTS_CONFIG_DEFAULTS.loyaltyReward,
      inactiveDays: clampInt(
        row.inactiveDays,
        INACTIVE_DAYS_MIN,
        INACTIVE_DAYS_MAX,
        BARBER_CLIENTS_CONFIG_DEFAULTS.inactiveDays,
      ),
      persisted: true,
    };
  } catch (e) {
    if (isMissingColumnError(e)) {
      configColumnsMissing = true;
      return fallback;
    }
    console.warn("[barber/clients] no se pudo leer la config:", (e as Error).message);
    return fallback;
  }
}

export interface SaveConfigResult {
  ok: boolean;
  /** "sql_pendiente" = falta aplicar sql/barber_clientes.sql. */
  reason?: "sql_pendiente" | "error";
  config: BarberClientsConfig;
}

/** Guarda la config. Los rangos se recortan aquí, no se confía en el cliente. */
export async function saveBarberClientsConfig(
  ctx: BarberContext,
  patch: {
    loyaltyEnabled?: unknown;
    loyaltyThreshold?: unknown;
    loyaltyReward?: unknown;
    inactiveDays?: unknown;
  },
): Promise<SaveConfigResult> {
  const current = await getBarberClientsConfig(ctx);
  const next: BarberClientsConfig = {
    loyaltyEnabled:
      typeof patch.loyaltyEnabled === "boolean" ? patch.loyaltyEnabled : current.loyaltyEnabled,
    loyaltyThreshold:
      patch.loyaltyThreshold === undefined
        ? current.loyaltyThreshold
        : clampInt(
            patch.loyaltyThreshold,
            LOYALTY_THRESHOLD_MIN,
            LOYALTY_THRESHOLD_MAX,
            current.loyaltyThreshold,
          ),
    loyaltyReward:
      typeof patch.loyaltyReward === "string"
        ? patch.loyaltyReward.trim().slice(0, 60) || BARBER_CLIENTS_CONFIG_DEFAULTS.loyaltyReward
        : current.loyaltyReward,
    inactiveDays:
      patch.inactiveDays === undefined
        ? current.inactiveDays
        : clampInt(patch.inactiveDays, INACTIVE_DAYS_MIN, INACTIVE_DAYS_MAX, current.inactiveDays),
    persisted: current.persisted,
  };

  if (configColumnsMissing) return { ok: false, reason: "sql_pendiente", config: next };

  const barbershopId = ctx.barbershopId;
  try {
    await prisma.$executeRaw`
      UPDATE "barber_shops"
      SET "loyaltyEnabled"   = ${next.loyaltyEnabled},
          "loyaltyThreshold" = ${next.loyaltyThreshold},
          "loyaltyReward"    = ${next.loyaltyReward},
          "inactiveDays"     = ${next.inactiveDays}
      WHERE "id" = ${barbershopId}
    `;
    return { ok: true, config: { ...next, persisted: true } };
  } catch (e) {
    if (isMissingColumnError(e)) {
      configColumnsMissing = true;
      return { ok: false, reason: "sql_pendiente", config: { ...next, persisted: false } };
    }
    console.warn("[barber/clients] no se pudo guardar la config:", (e as Error).message);
    return { ok: false, reason: "error", config: current };
  }
}

// ── Preferencias del cliente (Json) ────────────────────────────────────

/**
 * Lo que el barbero necesita ver de un golpe con el cliente ya sentado.
 * `preferences` es Json libre en el schema; ESTE es su contrato.
 *
 * Las llaves que empiezan con "__" son RESERVADAS del servidor (bitácora de
 * lealtad y motivo del bloqueo). Nunca se aceptan desde el navegador:
 * sanitizeClientPreferences() las tira, y mergeClientPreferences() las
 * conserva de la fila existente. Así un PATCH de preferencias no puede
 * inventarse canjes ni desbloquear a nadie.
 */
export const CLIENT_PREFERENCE_FIELDS = [
  "clipperNumber",
  "fade",
  "part",
  "topLength",
  "sideLength",
  "beard",
  "products",
  "avoidProducts",
  "barberNotes",
  "favoriteBarberId",
] as const;

export type BarberClientPreferenceField = (typeof CLIENT_PREFERENCE_FIELDS)[number];
export type BarberClientPreferences = Partial<Record<BarberClientPreferenceField, string>>;

/** Tope por campo: notas más largas, el resto son etiquetas cortas. */
const PREFERENCE_MAX_LEN: Record<BarberClientPreferenceField, number> = {
  clipperNumber: 24,
  fade: 40,
  part: 60,
  topLength: 60,
  sideLength: 60,
  beard: 60,
  products: 240,
  avoidProducts: 240,
  barberNotes: 800,
  favoriteBarberId: 40,
};

const RESERVED_PREFERENCE_PREFIX = "__";

interface LoyaltyRedemptionEntry {
  at: string;
  byUserId: string;
  threshold: number;
  reward: string;
  appointmentId: string | null;
  note: string | null;
}

/** Bitácora interna de lealtad. SOLO la escribe el servidor. */
export interface LoyaltyLedger {
  /** Visitas ya consumidas por canjes anteriores. El contador vivo se deriva de aquí. */
  redeemedVisits: number;
  redemptions: LoyaltyRedemptionEntry[];
}

export interface ClientBlockInfo {
  at: string;
  byUserId: string;
  reason: string | null;
}

export const LOYALTY_LEDGER_KEY = "__loyalty";
export const BLOCK_INFO_KEY = "__block";
/** Cuántos canjes se conservan en la bitácora (los viejos se recortan). */
export const LOYALTY_HISTORY_MAX = 50;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Preferencias PÚBLICAS (sin llaves reservadas) de una fila. */
export function readClientPreferences(raw: unknown): BarberClientPreferences {
  const src = asRecord(raw);
  const out: BarberClientPreferences = {};
  for (const key of CLIENT_PREFERENCE_FIELDS) {
    const v = src[key];
    if (typeof v === "string" && v.trim()) out[key] = v;
  }
  return out;
}

export function readLoyaltyLedger(raw: unknown): LoyaltyLedger {
  const node = asRecord(asRecord(raw)[LOYALTY_LEDGER_KEY]);
  const redeemed = Number(node.redeemedVisits);
  const list = Array.isArray(node.redemptions) ? node.redemptions : [];
  return {
    redeemedVisits: Number.isFinite(redeemed) && redeemed > 0 ? Math.floor(redeemed) : 0,
    redemptions: list
      .map((e) => {
        const r = asRecord(e);
        return {
          at: typeof r.at === "string" ? r.at : "",
          byUserId: typeof r.byUserId === "string" ? r.byUserId : "",
          threshold: Number.isFinite(Number(r.threshold)) ? Number(r.threshold) : 0,
          reward: typeof r.reward === "string" ? r.reward : "",
          appointmentId: typeof r.appointmentId === "string" ? r.appointmentId : null,
          note: typeof r.note === "string" ? r.note : null,
        };
      })
      .filter((e) => e.at),
  };
}

export function readBlockInfo(raw: unknown): ClientBlockInfo | null {
  const node = asRecord(asRecord(raw)[BLOCK_INFO_KEY]);
  if (typeof node.at !== "string" || !node.at) return null;
  return {
    at: node.at,
    byUserId: typeof node.byUserId === "string" ? node.byUserId : "",
    reason: typeof node.reason === "string" && node.reason ? node.reason : null,
  };
}

/** Quita llaves desconocidas y reservadas, recorta y normaliza. */
export function sanitizeClientPreferences(input: unknown): BarberClientPreferences {
  const src = asRecord(input);
  const out: BarberClientPreferences = {};
  for (const key of CLIENT_PREFERENCE_FIELDS) {
    const raw = src[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim().slice(0, PREFERENCE_MAX_LEN[key]);
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Preferencias nuevas + llaves reservadas que ya tenía la fila. Se usa en
 * TODA escritura de `preferences`: es lo que garantiza que un PATCH del
 * navegador no borre ni falsifique la bitácora de lealtad.
 */
export function mergeClientPreferences(
  existingRaw: unknown,
  publicPrefs: BarberClientPreferences,
): Prisma.InputJsonValue {
  const existing = asRecord(existingRaw);
  const merged: Record<string, unknown> = { ...publicPrefs };
  for (const [key, value] of Object.entries(existing)) {
    if (key.startsWith(RESERVED_PREFERENCE_PREFIX)) merged[key] = value;
  }
  return merged as Prisma.InputJsonValue;
}

/** Igual que mergeClientPreferences pero sustituyendo UNA llave reservada. */
export function withReservedPreference(
  existingRaw: unknown,
  key: string,
  value: unknown,
): Prisma.InputJsonValue {
  const existing = { ...asRecord(existingRaw) };
  if (value === null || value === undefined) delete existing[key];
  else existing[key] = value;
  return existing as Prisma.InputJsonValue;
}

// ── Teléfono ───────────────────────────────────────────────────────────

/**
 * El teléfono ES la llave del mostrador. Se guarda SIEMPRE normalizado a 10
 * dígitos (misma regla que el registro y que WhatsApp) para que el ÚNICO
 * (barbershopId, phone) haga su trabajo: "5512345678" y "+52 55 1234 5678"
 * tienen que colisionar, no crear dos fichas.
 */
export function normalizeBarberPhone(input: unknown): string | null {
  return mxTenDigits(typeof input === "string" ? input : "");
}

/**
 * Formas en que puede venir escrito un teléfono al BUSCAR, para que todas
 * encuentren la misma ficha.
 *
 * No basta con quitar la lada cuando el número está completo: en el
 * mostrador se pega un trozo ("+52 55 1234") y ahí los dígitos son
 * "52551234", que NUNCA aparece dentro del "5512345678" guardado. Por eso
 * se devuelven las variantes —con y sin 52/521 delante— y el WHERE las
 * prueba todas con un OR. Mejor eso que adivinar si ese 52 era la lada o
 * parte del número.
 */
export function phoneSearchVariants(term: string): string[] {
  const digits = term.replace(/\D/g, "");
  if (!digits) return [];
  const out = [digits];
  if (digits.length > 3 && digits.indexOf("521") === 0) out.push(digits.slice(3));
  if (digits.length > 2 && digits.indexOf("52") === 0) out.push(digits.slice(2));
  return Array.from(new Set(out)).filter((v) => v.length >= 3);
}

// ── Selección explícita de columnas ────────────────────────────────────
// Nunca `findMany` sin select: una columna nueva del schema (la mete otra
// terminal) no debe llegar al navegador ni romper la lectura.

const CLIENT_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  birthday: true,
  notes: true,
  preferences: true,
  photoUrl: true,
  loyaltyCount: true,
  totalVisits: true,
  lastVisitAt: true,
  blockedAt: true,
  portalEnabled: true,
  lastPortalLoginAt: true,
  createdAt: true,
} satisfies Prisma.BarberClientSelect;

export type BarberClientRow = Prisma.BarberClientGetPayload<{ select: typeof CLIENT_SELECT }>;

export function toBarberClientDTO(row: BarberClientRow): BarberClientDTO {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    birthday: row.birthday ? row.birthday.toISOString() : null,
    notes: row.notes,
    preferences: readClientPreferences(row.preferences) as Record<string, unknown>,
    photoUrl: row.photoUrl,
    loyaltyCount: row.loyaltyCount,
    totalVisits: row.totalVisits,
    lastVisitAt: row.lastVisitAt ? row.lastVisitAt.toISOString() : null,
    blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
    portalEnabled: row.portalEnabled,
    lastPortalLoginAt: row.lastPortalLoginAt ? row.lastPortalLoginAt.toISOString() : null,
  };
}

// ── Cumpleaños: fecha estable en cualquier zona ────────────────────────

/**
 * Un cumpleaños es un DÍA, no un instante. Guardarlo a medianoche local hace
 * que en otra zona salga el día anterior (el clásico off-by-one). Se ancla a
 * MEDIODÍA UTC: así el día y el mes son los mismos se lea desde donde se lea,
 * y el índice EXTRACT(MONTH FROM "birthday") de sql/barber_clientes.sql
 * coincide con lo que ve la UI.
 */
export function parseBirthday(input: unknown): Date | null {
  if (typeof input !== "string") return null;
  const m = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Rechaza 31 de febrero y compañía (Date.UTC desborda al mes siguiente).
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/** "YYYY-MM-DD" en UTC — el formato que espera <input type="date">. */
export function birthdayToInputValue(date: Date | null): string {
  if (!date) return "";
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Recuento REAL de visitas (la fuente de verdad del contador) ───────

export interface BarberVisitTally {
  visits: number;
  lastVisitAt: Date | null;
}

/**
 * Cuántas veces se ha sentado de verdad cada cliente, PARA TODA UNA PÁGINA
 * en dos lecturas (dos groupBy), no 4 por ficha.
 *
 * Qué cuenta como visita:
 *   · Cita en DONE — la que pasó por la agenda.
 *   · Venta SIN cita con al menos una línea de SERVICIO — el walk-in que
 *     llegó, se sentó y pagó en mostrador. Una venta de solo producto (una
 *     cera) NO es visita: nadie regala un corte por comprar pomada.
 * Las canceladas y los NO_SHOW no cuentan.
 *
 * Vive aquí (capa de datos) y no en loyalty.ts para que la lista pueda
 * usarlo sin importar el motor de lealtad — si no, el ciclo de imports.
 */
export async function tallyVisitsForClients(
  barbershopId: string,
  clientIds: string[],
): Promise<Map<string, BarberVisitTally>> {
  const out = new Map<string, BarberVisitTally>();
  if (clientIds.length === 0) return out;

  const [appts, sales] = await Promise.all([
    prisma.barberAppointment.groupBy({
      by: ["clientId"],
      where: { barbershopId, clientId: { in: clientIds }, status: "DONE" },
      _count: { _all: true },
      _max: { startAt: true },
    }),
    prisma.barberSale.groupBy({
      by: ["clientId"],
      where: {
        barbershopId,
        clientId: { in: clientIds },
        appointmentId: null,
        items: { some: { serviceId: { not: null } } },
      },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  ]);

  const bump = (id: string | null, count: number, at: Date | null) => {
    if (!id) return;
    const prev = out.get(id) ?? { visits: 0, lastVisitAt: null };
    const nextAt =
      at && (!prev.lastVisitAt || at.getTime() > prev.lastVisitAt.getTime())
        ? at
        : prev.lastVisitAt;
    out.set(id, { visits: prev.visits + count, lastVisitAt: nextAt });
  };

  for (const g of appts) bump(g.clientId, g._count._all, g._max.startAt ?? null);
  for (const g of sales) bump(g.clientId, g._count._all, g._max.createdAt ?? null);

  for (const id of clientIds) if (!out.has(id)) out.set(id, { visits: 0, lastVisitAt: null });
  return out;
}

/** Atajo de un solo cliente (mismo motor, misma definición de visita). */
export async function tallyVisitsForClient(
  barbershopId: string,
  clientId: string,
): Promise<BarberVisitTally> {
  const map = await tallyVisitsForClients(barbershopId, [clientId]);
  return map.get(clientId) ?? { visits: 0, lastVisitAt: null };
}

// ── Listado ────────────────────────────────────────────────────────────

export type BarberClientListFilter = "all" | "birthday" | "inactive" | "blocked" | "reward";

export interface BarberClientListItem extends BarberClientDTO {
  /** Tiene una membresía ACTIVE y vigente hoy. */
  hasMembership: boolean;
  /** Ya juntó los sellos que pide la barbería. */
  rewardAvailable: boolean;
  /** Día del mes del cumpleaños (solo se llena en la vista de cumpleaños). */
  birthdayDay: number | null;
}

export interface BarberClientListResult {
  items: BarberClientListItem[];
  total: number;
  page: number;
  pageSize: number;
  config: BarberClientsConfig;
}

export const CLIENTS_PAGE_SIZE = 25;

function inactiveCutoff(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * WHERE de "inactivo": sin visita desde hace X días. Los que nunca han
 * venido entran SOLO si ya llevan más de X días dados de alta — si no, un
 * cliente capturado ayer aparecería como inactivo el mismo día.
 * Ojo: `lastVisitAt: { lt: cutoff }` NO incluye los NULL (así funciona SQL),
 * por eso la rama explícita.
 */
function inactiveWhere(cutoff: Date): Prisma.BarberClientWhereInput {
  return {
    blockedAt: null,
    OR: [
      { lastVisitAt: { lt: cutoff } },
      { AND: [{ lastVisitAt: null }, { createdAt: { lt: cutoff } }] },
    ],
  };
}

/** Ids de la barbería cuyo cumpleaños cae en `month` (1-12). */
async function birthdayIdsForMonth(barbershopId: string, month: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "barber_clients"
    WHERE "barbershopId" = ${barbershopId}
      AND "birthday" IS NOT NULL
      AND EXTRACT(MONTH FROM "birthday") = ${month}
    ORDER BY EXTRACT(DAY FROM "birthday") ASC
  `;
  return rows.map((r) => r.id);
}

export interface ListClientsArgs {
  search?: string;
  filter?: BarberClientListFilter;
  page?: number;
  /** Mes 1-12 para la vista de cumpleaños. Default: el mes de hoy. */
  month?: number;
}

export async function listBarberClients(
  ctx: BarberContext,
  args: ListClientsArgs = {},
): Promise<BarberClientListResult> {
  const barbershopId = ctx.barbershopId;
  const config = await getBarberClientsConfig(ctx);
  const filter: BarberClientListFilter = args.filter ?? "all";
  const page = Math.max(1, Math.floor(args.page ?? 1));

  const where: Prisma.BarberClientWhereInput = { barbershopId };

  const term = (args.search ?? "").trim().slice(0, 80);
  if (term) {
    const or: Prisma.BarberClientWhereInput[] = [
      { name: { contains: term, mode: "insensitive" } },
    ];
    for (const variant of phoneSearchVariants(term)) {
      or.push({ phone: { contains: variant } });
    }
    if (term.indexOf("@") >= 0) or.push({ email: { contains: term, mode: "insensitive" } });
    where.AND = [{ OR: or }];
  }

  let birthdayOrder: string[] | null = null;

  if (filter === "blocked") {
    where.blockedAt = { not: null };
  } else if (filter === "reward") {
    where.blockedAt = null;
    where.loyaltyCount = { gte: config.loyaltyThreshold };
  } else if (filter === "inactive") {
    const extra = inactiveWhere(inactiveCutoff(config.inactiveDays));
    where.blockedAt = null;
    where.OR = extra.OR;
  } else if (filter === "birthday") {
    const month = args.month && args.month >= 1 && args.month <= 12
      ? args.month
      : new Date().getUTCMonth() + 1;
    birthdayOrder = await birthdayIdsForMonth(barbershopId, month);
    if (birthdayOrder.length === 0) {
      return { items: [], total: 0, page: 1, pageSize: CLIENTS_PAGE_SIZE, config };
    }
    where.id = { in: birthdayOrder };
    where.blockedAt = null;
  }
  // filter === "all": los BLOQUEADOS SÍ salen (con su distintivo). Si se
  // escondieran, buscar el teléfono del que nunca llega no daría resultado y
  // el mostrador lo volvería a sentar sin ver el aviso — justo lo contrario
  // de para qué sirve bloquear.

  // `barbershopId` se repite aquí a propósito aunque ya venga dentro de
  // `where`: el filtro de barbería tiene que verse EN la llamada. Va al
  // final del spread, así que gana siempre — ni un refactor del objeto
  // `where` puede ampliar el alcance sin que se note.
  // La vista de cumpleaños se ordena por DÍA DEL MES, y ese orden lo decide
  // el SQL de birthdayIdsForMonth — no un ORDER BY que Postgres pueda hacer
  // sobre `id IN (...)`. Por eso ahí se traen todas las filas del mes (tope
  // 500), se reordenan en memoria y se corta la página después: paginar en
  // SQL por nombre y luego reordenar por día daría una página con la gente
  // equivocada. En las demás vistas se pagina normal, en la base.
  const takeAll = birthdayOrder !== null;
  const [total, rawRows] = await Promise.all([
    prisma.barberClient.count({ where: { ...where, barbershopId } }),
    prisma.barberClient.findMany({
      where: { ...where, barbershopId },
      select: CLIENT_SELECT,
      // nulls: "last" para que los que nunca han venido no encabecen la lista.
      orderBy: takeAll
        ? [{ name: "asc" }]
        : [{ lastVisitAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
      skip: takeAll ? 0 : (page - 1) * CLIENTS_PAGE_SIZE,
      take: takeAll ? 500 : CLIENTS_PAGE_SIZE,
    }),
  ]);

  let rows = rawRows;
  if (birthdayOrder) {
    const rank = new Map(birthdayOrder.map((id, i) => [id, i]));
    rows = rawRows
      .slice()
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
      .slice((page - 1) * CLIENTS_PAGE_SIZE, page * CLIENTS_PAGE_SIZE);
  }

  const ids = rows.map((r) => r.id);
  const [memberships, tallies] = await Promise.all([
    ids.length
      ? prisma.barberClientMembership.findMany({
          where: {
            barbershopId,
            clientId: { in: ids },
            status: "ACTIVE",
            endAt: { gt: new Date() },
          },
          select: { clientId: true },
        })
      : Promise.resolve([] as Array<{ clientId: string }>),
    tallyVisitsForClients(barbershopId, ids),
  ]);
  const withMembership = new Set(memberships.map((m) => m.clientId));

  // ── El contador NO se lee: se recalcula ──────────────────────────────
  // Las columnas loyaltyCount / totalVisits / lastVisitAt son una CACHÉ
  // (la lista filtra y ordena por ellas en SQL, que es lo único que no se
  // puede hacer en memoria). Aquí se recalculan desde las visitas reales y
  // se refresca la fila SOLO si cambió. Consecuencia: si alguna ola cierra
  // visitas sin llamar a registerBarberVisit(), el número se corrige solo
  // —lo que se ve, ya; el filtro y el orden, en la siguiente carga— y en
  // régimen normal esto no escribe absolutamente nada.
  const stale: Array<{ id: string; loyaltyCount: number; totalVisits: number; lastVisitAt: Date | null }> = [];
  const derived = new Map<string, { count: number; visits: number; lastVisitAt: Date | null }>();
  for (const row of rows) {
    const tally = tallies.get(row.id) ?? { visits: 0, lastVisitAt: null };
    const ledger = readLoyaltyLedger(row.preferences);
    const count = Math.max(0, tally.visits - ledger.redeemedVisits);
    derived.set(row.id, { count, visits: tally.visits, lastVisitAt: tally.lastVisitAt });
    const sameDate =
      (row.lastVisitAt ? row.lastVisitAt.getTime() : null) ===
      (tally.lastVisitAt ? tally.lastVisitAt.getTime() : null);
    if (row.loyaltyCount !== count || row.totalVisits !== tally.visits || !sameDate) {
      stale.push({
        id: row.id,
        loyaltyCount: count,
        totalVisits: tally.visits,
        lastVisitAt: tally.lastVisitAt,
      });
    }
  }
  if (stale.length > 0) {
    try {
      await prisma.$transaction(
        stale.map((u) =>
          prisma.barberClient.update({
            where: { id: u.id, barbershopId },
            data: {
              loyaltyCount: u.loyaltyCount,
              totalVisits: u.totalVisits,
              lastVisitAt: u.lastVisitAt,
            },
          }),
        ),
      );
    } catch (e) {
      // Refrescar la caché nunca puede tumbar la lista.
      console.warn("[barber/clients] no se pudo refrescar el contador:", (e as Error).message);
    }
  }

  const items: BarberClientListItem[] = rows.map((row) => {
    const d = derived.get(row.id);
    const dto = toBarberClientDTO(row);
    const loyaltyCount = d ? d.count : row.loyaltyCount;
    return {
      ...dto,
      loyaltyCount,
      totalVisits: d ? d.visits : row.totalVisits,
      // Si el recuento dice que no ha venido nunca, manda el recuento —
      // aunque la columna guardara una fecha vieja. Devolver el dato viejo
      // después de haberlo corregido en la base sería mentir dos veces.
      lastVisitAt: d ? (d.lastVisitAt ? d.lastVisitAt.toISOString() : null) : dto.lastVisitAt,
      hasMembership: withMembership.has(row.id),
      rewardAvailable: config.loyaltyEnabled && loyaltyCount >= config.loyaltyThreshold,
      birthdayDay: row.birthday ? row.birthday.getUTCDate() : null,
    };
  });

  return { items, total, page, pageSize: CLIENTS_PAGE_SIZE, config };
}

// ── Alta / vinculación por teléfono ────────────────────────────────────

export interface UpsertClientInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  birthday?: unknown;
  notes?: unknown;
  preferences?: unknown;
}

/**
 * Resultado plano (no unión discriminada) A PROPÓSITO: el repo compila con
 * strict:false, y sin strictNullChecks TypeScript NO estrecha una unión por
 * la verdad de un booleano — `if (!r.ok)` deja el tipo entero y `r.error` no
 * existe. Campos opcionales: quien lee comprueba `ok` y ya.
 */
export interface UpsertClientResult {
  ok: boolean;
  created?: boolean;
  client?: BarberClientRow;
  error?: string;
  field?: "name" | "phone" | "email" | "birthday";
}

function cleanEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const v = input.trim().toLowerCase().slice(0, 160);
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : "";
}

/**
 * Alta de cliente. El teléfono es ÚNICO por barbería: si ya existe, NO se
 * duplica — se VINCULA (se devuelve la ficha existente, completando los
 * huecos que traiga el alta: correo, cumpleaños, notas). Es lo que pasa de
 * verdad en el mostrador: el mismo señor "se da de alta" tres veces.
 *
 * La carrera de dos altas simultáneas la resuelve el índice único con un
 * P2002 que se atrapa y se convierte en vinculación.
 */
export async function createOrLinkBarberClient(
  ctx: BarberContext,
  input: UpsertClientInput,
): Promise<UpsertClientResult> {
  const barbershopId = ctx.barbershopId;

  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  if (!name) return { ok: false, error: "Escribe el nombre del cliente.", field: "name" };

  const phone = normalizeBarberPhone(input.phone);
  if (!phone) {
    return { ok: false, error: "Escribe el teléfono a 10 dígitos.", field: "phone" };
  }

  const email = cleanEmail(input.email);
  if (email === "") return { ok: false, error: "Ese correo no se ve bien.", field: "email" };

  let birthday: Date | null = null;
  if (typeof input.birthday === "string" && input.birthday.trim()) {
    birthday = parseBirthday(input.birthday);
    if (!birthday) return { ok: false, error: "Esa fecha no existe.", field: "birthday" };
  }

  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : null;
  const prefs = sanitizeClientPreferences(input.preferences);

  /** Completa SOLO los huecos de la ficha existente; nunca pisa lo que ya hay. */
  const fillGaps = async (row: BarberClientRow): Promise<BarberClientRow> => {
    const data: Prisma.BarberClientUpdateInput = {};
    if (!row.email && email) data.email = email;
    if (!row.birthday && birthday) data.birthday = birthday;
    if (!row.notes && notes) data.notes = notes;
    const currentPrefs = readClientPreferences(row.preferences);
    const missing = Object.entries(prefs).filter(([k]) => !(k in currentPrefs));
    if (missing.length) {
      data.preferences = mergeClientPreferences(row.preferences, {
        ...currentPrefs,
        ...Object.fromEntries(missing),
      });
    }
    if (Object.keys(data).length === 0) return row;
    return prisma.barberClient.update({
      where: { id: row.id, barbershopId },
      data,
      select: CLIENT_SELECT,
    });
  };

  const existing = await prisma.barberClient.findFirst({
    where: { barbershopId, phone },
    select: CLIENT_SELECT,
  });

  if (existing) return { ok: true, created: false, client: await fillGaps(existing) };

  try {
    const created = await prisma.barberClient.create({
      data: {
        barbershopId,
        name,
        phone,
        email: email || null,
        birthday,
        notes,
        preferences: mergeClientPreferences(null, prefs),
      },
      select: CLIENT_SELECT,
    });
    return { ok: true, created: true, client: created };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Otra alta ganó la carrera por milisegundos: vinculamos con la suya.
      const row = await prisma.barberClient.findFirst({
        where: { barbershopId, phone },
        select: CLIENT_SELECT,
      });
      if (row) return { ok: true, created: false, client: await fillGaps(row) };
    }
    throw e;
  }
}

/** Ficha por id, SIEMPRE recortada a la barbería de la sesión. */
export async function findBarberClient(
  ctx: BarberContext,
  clientId: string,
): Promise<BarberClientRow | null> {
  if (!clientId) return null;
  return prisma.barberClient.findFirst({
    where: { id: clientId, barbershopId: ctx.barbershopId },
    select: CLIENT_SELECT,
  });
}

/** Ver la nota de UpsertClientResult sobre strict:false. */
export interface UpdateClientResult {
  ok: boolean;
  client?: BarberClientRow;
  error?: string;
  field?: "name" | "phone" | "email" | "birthday";
}

export async function updateBarberClient(
  ctx: BarberContext,
  clientId: string,
  input: UpsertClientInput,
): Promise<UpdateClientResult> {
  const row = await findBarberClient(ctx, clientId);
  if (!row) return { ok: false, error: "Ese cliente no es de esta barbería." };

  const data: Prisma.BarberClientUpdateInput = {};

  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
    if (!name) return { ok: false, error: "Escribe el nombre del cliente.", field: "name" };
    data.name = name;
  }

  if (input.phone !== undefined) {
    const phone = normalizeBarberPhone(input.phone);
    if (!phone) return { ok: false, error: "Escribe el teléfono a 10 dígitos.", field: "phone" };
    if (phone !== row.phone) {
      const clash = await prisma.barberClient.findFirst({
        where: { barbershopId: ctx.barbershopId, phone, id: { not: clientId } },
        select: { id: true, name: true },
      });
      if (clash) {
        return {
          ok: false,
          error: `Ese teléfono ya es de ${clash.name}.`,
          field: "phone",
        };
      }
      data.phone = phone;
    }
  }

  if (input.email !== undefined) {
    const email = cleanEmail(input.email);
    if (email === "") return { ok: false, error: "Ese correo no se ve bien.", field: "email" };
    data.email = email;
  }

  if (input.birthday !== undefined) {
    const raw = typeof input.birthday === "string" ? input.birthday.trim() : "";
    if (!raw) data.birthday = null;
    else {
      const parsed = parseBirthday(raw);
      if (!parsed) return { ok: false, error: "Esa fecha no existe.", field: "birthday" };
      data.birthday = parsed;
    }
  }

  if (input.notes !== undefined) {
    const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "";
    data.notes = notes || null;
  }

  if (Object.keys(data).length === 0) return { ok: true, client: row };

  try {
    const updated = await prisma.barberClient.update({
      where: { id: clientId, barbershopId: ctx.barbershopId },
      data,
      select: CLIENT_SELECT,
    });
    return { ok: true, client: updated };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "Ese teléfono ya está en otra ficha.", field: "phone" };
    }
    throw e;
  }
}

/** Guarda SOLO las preferencias públicas; conserva las llaves reservadas. */
export async function saveClientPreferences(
  ctx: BarberContext,
  clientId: string,
  input: unknown,
): Promise<BarberClientRow | null> {
  const row = await findBarberClient(ctx, clientId);
  if (!row) return null;

  const prefs = sanitizeClientPreferences(input);

  // El barbero favorito tiene que ser un barbero DE ESTA barbería.
  if (prefs.favoriteBarberId) {
    const barber = await prisma.barber.findFirst({
      where: { id: prefs.favoriteBarberId, barbershopId: ctx.barbershopId },
      select: { id: true },
    });
    if (!barber) delete prefs.favoriteBarberId;
  }

  return prisma.barberClient.update({
    where: { id: clientId, barbershopId: ctx.barbershopId },
    data: { preferences: mergeClientPreferences(row.preferences, prefs) },
    select: CLIENT_SELECT,
  });
}

// ── Bloquear (que NO es borrar) ────────────────────────────────────────

/**
 * El que no llega tres veces se bloquea, no se borra: su historial de cortes
 * y su tarjeta de lealtad siguen ahí para el día que vuelva. El motivo se
 * guarda en la llave reservada __block, que el navegador no puede escribir.
 */
export async function setBarberClientBlocked(
  ctx: BarberContext,
  clientId: string,
  blocked: boolean,
  reason?: unknown,
): Promise<BarberClientRow | null> {
  const row = await findBarberClient(ctx, clientId);
  if (!row) return null;

  const info: ClientBlockInfo | null = blocked
    ? {
        at: new Date().toISOString(),
        byUserId: ctx.barberUserId,
        reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : null,
      }
    : null;

  return prisma.barberClient.update({
    where: { id: clientId, barbershopId: ctx.barbershopId },
    data: {
      blockedAt: blocked ? new Date() : null,
      preferences: withReservedPreference(row.preferences, BLOCK_INFO_KEY, info),
    },
    select: CLIENT_SELECT,
  });
}

/**
 * PUNTO DE EXTENSIÓN para la agenda (T1) y la reserva pública (T5).
 *
 * Antes de sentar a alguien en la silla, esto responde "¿este teléfono ya es
 * cliente, y está bloqueado?". Devuelve `null` en `client` si no existe: el
 * flujo de reserva decide si lo da de alta con createOrLinkBarberClient.
 */
export async function lookupBarberClientByPhone(
  ctx: BarberContext,
  rawPhone: unknown,
): Promise<{
  phone: string | null;
  client: BarberClientDTO | null;
  blocked: boolean;
  blockReason: string | null;
}> {
  const phone = normalizeBarberPhone(rawPhone);
  if (!phone) return { phone: null, client: null, blocked: false, blockReason: null };

  const row = await prisma.barberClient.findFirst({
    where: { barbershopId: ctx.barbershopId, phone },
    select: CLIENT_SELECT,
  });
  if (!row) return { phone, client: null, blocked: false, blockReason: null };

  const block = readBlockInfo(row.preferences);
  return {
    phone,
    client: toBarberClientDTO(row),
    blocked: row.blockedAt !== null,
    blockReason: block?.reason ?? null,
  };
}

// ── Cumpleaños e inactivos: la lista que T7 va a mandar por WhatsApp ───

export type BarberOutreachKind = "birthday" | "inactive";

export interface BarberOutreachTarget {
  clientId: string;
  name: string;
  /** 10 dígitos, listo para normalizeMxWhatsAppPhone. */
  phone: string;
  lastVisitAt: string | null;
  daysSinceLastVisit: number | null;
  birthday: string | null;
  /** Día del mes (1-31) cuando kind = "birthday". */
  birthdayDay: number | null;
  totalVisits: number;
  loyaltyCount: number;
}

export interface BarberOutreachList {
  kind: BarberOutreachKind;
  /** Mes 1-12 (solo en "birthday"). */
  month: number | null;
  /** Días de inactividad usados (solo en "inactive"). */
  days: number | null;
  targets: BarberOutreachTarget[];
  total: number;
}

/**
 * ── GANCHO PARA T7 (WhatsApp) ────────────────────────────────────────
 * Este módulo NO envía nada. Prepara la lista y la deja lista para que la
 * ola de WhatsApp la recorra:
 *
 *   const lista = await listBarberOutreach(ctx, { kind: "inactive" });
 *   for (const t of lista.targets) await enviarPlantilla(t.phone, ...);
 *
 * Reglas ya aplicadas aquí (T7 no las tiene que repetir):
 *   · Solo clientes de ctx.barbershopId.
 *   · Los BLOQUEADOS quedan fuera: a un bloqueado no se le manda publicidad.
 *   · Teléfono normalizado a 10 dígitos.
 *   · Tope de 500 para que un envío masivo no salga de un solo query.
 * También lo consume GET /api/barber/clients/outreach.
 */
export async function listBarberOutreach(
  ctx: BarberContext,
  args: { kind: BarberOutreachKind; month?: number; days?: number; limit?: number },
): Promise<BarberOutreachList> {
  const barbershopId = ctx.barbershopId;
  const config = await getBarberClientsConfig(ctx);
  const limit = Math.min(500, Math.max(1, Math.floor(args.limit ?? 500)));
  const now = Date.now();

  const toTarget = (row: BarberClientRow): BarberOutreachTarget => ({
    clientId: row.id,
    name: row.name,
    phone: row.phone,
    lastVisitAt: row.lastVisitAt ? row.lastVisitAt.toISOString() : null,
    daysSinceLastVisit: row.lastVisitAt
      ? Math.floor((now - row.lastVisitAt.getTime()) / (24 * 60 * 60 * 1000))
      : null,
    birthday: row.birthday ? row.birthday.toISOString() : null,
    birthdayDay: row.birthday ? row.birthday.getUTCDate() : null,
    totalVisits: row.totalVisits,
    loyaltyCount: row.loyaltyCount,
  });

  if (args.kind === "birthday") {
    const month =
      args.month && args.month >= 1 && args.month <= 12
        ? args.month
        : new Date().getUTCMonth() + 1;
    const ids = await birthdayIdsForMonth(barbershopId, month);
    if (!ids.length) return { kind: "birthday", month, days: null, targets: [], total: 0 };

    const rows = await prisma.barberClient.findMany({
      where: { barbershopId, id: { in: ids }, blockedAt: null },
      select: CLIENT_SELECT,
      take: limit,
    });
    const rank = new Map(ids.map((id, i) => [id, i]));
    const targets = rows
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
      .map(toTarget);
    return { kind: "birthday", month, days: null, targets, total: targets.length };
  }

  const days = Math.min(
    INACTIVE_DAYS_MAX,
    Math.max(INACTIVE_DAYS_MIN, Math.floor(args.days ?? config.inactiveDays)),
  );
  const cutoff = inactiveCutoff(days);
  const where: Prisma.BarberClientWhereInput = { barbershopId, ...inactiveWhere(cutoff) };
  const [total, rows] = await Promise.all([
    prisma.barberClient.count({ where: { ...where, barbershopId } }),
    prisma.barberClient.findMany({
      where: { ...where, barbershopId },
      select: CLIENT_SELECT,
      orderBy: [{ lastVisitAt: { sort: "desc", nulls: "last" } }],
      take: limit,
    }),
  ]);
  return { kind: "inactive", month: null, days, targets: rows.map(toTarget), total };
}

// ── Fotos del corte (Supabase Storage, bucket PRIVADO) ─────────────────

/**
 * Las fotos NO viven en la BD ni en un bucket público: viven en
 * `barber-files` (privado, ver sql/barber_clientes.sql) bajo una ruta
 * particionada por barbería:
 *
 *   clients/<barbershopId>/<clientId>/<timestamp>-<rand>.<ext>
 *
 * `BarberVisitPhoto.url` guarda ESE PATH, no una URL. La URL se firma
 * on-demand (5 min) DESPUÉS de comprobar que la fila es de la barbería de
 * la sesión. Consecuencia buscada: aunque alguien se robe el link, caduca; y
 * una barbería no puede ni adivinar la ruta de otra porque el barbershopId
 * de la ruta sale de la sesión, jamás del request.
 */
export const PHOTO_SIGNED_URL_TTL = 300;

/** Techo del servidor. El navegador ya comprime a ~200-400 KB (WebP 1600px). */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

/** Máximo de fotos por visita y por ficha, para que el bucket no crezca solo. */
export const PHOTOS_MAX_PER_APPOINTMENT = 12;
export const PHOTOS_MAX_PER_CLIENT = 300;

const PHOTO_MIME_EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/**
 * Tipo real por firma de bytes. El `Content-Type` del multipart lo pone el
 * cliente y se puede mentir: si alguien sube un .html diciendo que es webp,
 * acaba servido desde nuestro dominio. Aquí se mira el archivo.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  const riff = String.fromCharCode(b[0], b[1], b[2], b[3]);
  const webp = String.fromCharCode(b[8], b[9], b[10], b[11]);
  if (riff === "RIFF" && webp === "WEBP") return "image/webp";
  return null;
}

let cachedAdmin: ReturnType<typeof createAdminClient> | null = null;
/** Cliente admin propio del vertical (mismo patrón que /api/barber/auth/register). */
function storageAdmin() {
  if (cachedAdmin) return cachedAdmin;
  cachedAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return cachedAdmin;
}

export function buildBarberPhotoPath(args: {
  barbershopId: string;
  clientId: string;
  mime: string;
}): string {
  const ext = PHOTO_MIME_EXT[args.mime] ?? "bin";
  const rand = Math.random().toString(36).slice(2, 10);
  return `clients/${args.barbershopId}/${args.clientId}/${Date.now()}-${rand}.${ext}`;
}

/** Firma un lote de paths en UN round-trip. Los que fallen quedan en "". */
export async function signBarberPhotoPaths(paths: string[]): Promise<string[]> {
  const out: string[] = new Array(paths.length).fill("");
  if (paths.length === 0) return out;
  try {
    const { data, error } = await storageAdmin()
      .storage.from(BARBER_FILES_BUCKET)
      .createSignedUrls(paths, PHOTO_SIGNED_URL_TTL);
    if (error || !data) {
      console.warn("[barber/clients] no se pudieron firmar las fotos:", error?.message);
      return out;
    }
    data.forEach((row, i) => {
      if (!row.error && row.signedUrl) out[i] = row.signedUrl;
    });
  } catch (e) {
    console.warn("[barber/clients] excepción al firmar fotos:", (e as Error).message);
  }
  return out;
}

export interface SaveVisitPhotoArgs {
  clientId: string;
  appointmentId?: string | null;
  kind: BarberPhotoKind;
  visibleToClient: boolean;
  mime: string;
  body: Uint8Array;
}

/** Ver la nota de UpsertClientResult sobre strict:false. */
export interface SaveVisitPhotoResult {
  ok: boolean;
  photo?: BarberVisitPhotoDTO;
  signedUrl?: string;
  error?: string;
}

export async function saveBarberVisitPhoto(
  ctx: BarberContext,
  args: SaveVisitPhotoArgs,
): Promise<SaveVisitPhotoResult> {
  const barbershopId = ctx.barbershopId;

  const client = await findBarberClient(ctx, args.clientId);
  if (!client) return { ok: false, error: "Ese cliente no es de esta barbería." };

  // La cita también tiene que ser de esta barbería Y de este cliente.
  let appointmentId: string | null = null;
  if (args.appointmentId) {
    const appt = await prisma.barberAppointment.findFirst({
      where: { id: args.appointmentId, barbershopId, clientId: args.clientId },
      select: { id: true },
    });
    if (!appt) return { ok: false, error: "Esa visita no es de este cliente." };
    appointmentId = appt.id;

    const perVisit = await prisma.barberVisitPhoto.count({
      where: { barbershopId, appointmentId },
    });
    if (perVisit >= PHOTOS_MAX_PER_APPOINTMENT) {
      return {
        ok: false,
        error: `Esta visita ya tiene ${PHOTOS_MAX_PER_APPOINTMENT} fotos.`,
      };
    }
  }

  const perClient = await prisma.barberVisitPhoto.count({
    where: { barbershopId, clientId: args.clientId },
  });
  if (perClient >= PHOTOS_MAX_PER_CLIENT) {
    return { ok: false, error: `Esta ficha ya tiene ${PHOTOS_MAX_PER_CLIENT} fotos.` };
  }

  const path = buildBarberPhotoPath({ barbershopId, clientId: args.clientId, mime: args.mime });
  const { error: upErr } = await storageAdmin()
    .storage.from(BARBER_FILES_BUCKET)
    .upload(path, args.body, { contentType: args.mime, upsert: false });
  if (upErr) {
    console.warn("[barber/clients] falló la subida de la foto:", upErr.message);
    return { ok: false, error: "No se pudo guardar la foto. Inténtalo otra vez." };
  }

  try {
    const row = await prisma.barberVisitPhoto.create({
      data: {
        barbershopId,
        clientId: args.clientId,
        appointmentId,
        url: path,
        kind: args.kind,
        visibleToClient: args.visibleToClient,
        uploadedByUserId: ctx.barberUserId,
      },
      select: PHOTO_SELECT,
    });
    const [signedUrl] = await signBarberPhotoPaths([path]);
    return { ok: true, photo: toVisitPhotoDTO(row), signedUrl: signedUrl ?? "" };
  } catch (e) {
    // La fila no se creó: el binario quedaría huérfano ocupando bucket.
    await removeBarberPhotoBinary(path);
    throw e;
  }
}

const PHOTO_SELECT = {
  id: true,
  clientId: true,
  appointmentId: true,
  url: true,
  kind: true,
  visibleToClient: true,
  uploadedByUserId: true,
  createdAt: true,
} satisfies Prisma.BarberVisitPhotoSelect;

type PhotoRow = Prisma.BarberVisitPhotoGetPayload<{ select: typeof PHOTO_SELECT }>;

function toVisitPhotoDTO(row: PhotoRow): BarberVisitPhotoDTO {
  return {
    id: row.id,
    clientId: row.clientId,
    appointmentId: row.appointmentId,
    url: row.url,
    kind: row.kind,
    visibleToClient: row.visibleToClient,
    uploadedByUserId: row.uploadedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** DTO + la URL firmada lista para pintar. `url` sigue siendo el path interno. */
export interface BarberVisitPhotoView extends BarberVisitPhotoDTO {
  signedUrl: string;
}

export async function listBarberClientPhotos(
  ctx: BarberContext,
  clientId: string,
  opts: { take?: number; appointmentId?: string | null } = {},
): Promise<BarberVisitPhotoView[]> {
  const where: Prisma.BarberVisitPhotoWhereInput = {
    barbershopId: ctx.barbershopId,
    clientId,
  };
  if (opts.appointmentId !== undefined) where.appointmentId = opts.appointmentId;

  const rows = await prisma.barberVisitPhoto.findMany({
    where: { ...where, barbershopId: ctx.barbershopId },
    select: PHOTO_SELECT,
    orderBy: { createdAt: "desc" },
    take: Math.min(PHOTOS_MAX_PER_CLIENT, Math.max(1, opts.take ?? 60)),
  });
  const signed = await signBarberPhotoPaths(rows.map((r) => r.url));
  return rows.map((row, i) => ({ ...toVisitPhotoDTO(row), signedUrl: signed[i] ?? "" }));
}

/**
 * `clientId` se pasa SIEMPRE que la ruta lo tenga: así el where recorta por
 * barbería Y por ficha, y una foto de otro cliente no se puede tocar ni por
 * accidente ni a propósito cambiando el id de la URL.
 */
export async function updateBarberVisitPhoto(
  ctx: BarberContext,
  photoId: string,
  patch: { visibleToClient?: unknown; kind?: unknown },
  clientId?: string,
): Promise<BarberVisitPhotoView | null> {
  const row = await prisma.barberVisitPhoto.findFirst({
    where: { id: photoId, barbershopId: ctx.barbershopId, ...(clientId ? { clientId } : {}) },
    select: PHOTO_SELECT,
  });
  if (!row) return null;

  const data: Prisma.BarberVisitPhotoUpdateInput = {};
  if (typeof patch.visibleToClient === "boolean") data.visibleToClient = patch.visibleToClient;
  if (patch.kind === "BEFORE" || patch.kind === "AFTER" || patch.kind === "REFERENCE") {
    data.kind = patch.kind;
  }
  const updated = Object.keys(data).length
    ? await prisma.barberVisitPhoto.update({
        where: { id: photoId, barbershopId: ctx.barbershopId },
        data,
        select: PHOTO_SELECT,
      })
    : row;

  const [signedUrl] = await signBarberPhotoPaths([updated.url]);
  return { ...toVisitPhotoDTO(updated), signedUrl: signedUrl ?? "" };
}

async function removeBarberPhotoBinary(path: string): Promise<void> {
  try {
    const { error } = await storageAdmin()
      .storage.from(BARBER_FILES_BUCKET)
      .remove([path]);
    if (error) console.warn("[barber/clients] no se pudo borrar el binario:", error.message);
  } catch (e) {
    console.warn("[barber/clients] excepción al borrar el binario:", (e as Error).message);
  }
}

export async function deleteBarberVisitPhoto(
  ctx: BarberContext,
  photoId: string,
  clientId?: string,
): Promise<boolean> {
  const row = await prisma.barberVisitPhoto.findFirst({
    where: { id: photoId, barbershopId: ctx.barbershopId, ...(clientId ? { clientId } : {}) },
    select: { id: true, url: true },
  });
  if (!row) return false;
  await prisma.barberVisitPhoto.delete({ where: { id: row.id, barbershopId: ctx.barbershopId } });
  await removeBarberPhotoBinary(row.url);
  return true;
}

// ── FRONTERA CON T5: qué expone esta capa al PORTAL DEL CLIENTE ────────

/** Foto tal y como la puede ver el cliente final: sin path interno. */
export interface BarberPortalPhoto {
  id: string;
  kind: BarberPhotoKind;
  appointmentId: string | null;
  createdAt: string;
  /** URL firmada de 5 minutos. El path del bucket NO sale de aquí. */
  signedUrl: string;
}

/**
 * ÚNICA lectura de fotos pensada para el portal del cliente (T5).
 *
 * Devuelve SOLO las marcadas `visibleToClient`. Una foto que el barbero no
 * publicó no sale por aquí ni por error: la condición está en el WHERE, no
 * en un filtro posterior que se pueda olvidar al mapear.
 *
 * ⚠️ OJO CON LOS PARÁMETROS: esta es la ÚNICA función del módulo que recibe
 * el barbershopId suelto, porque el portal NO tiene sesión de barbería —
 * tiene la del propio cliente. Los DOS ids tienen que salir del token del
 * portal ya verificado (BarberClientAuthToken: clientId + barbershopId),
 * JAMÁS del query o del body. Si T5 los toma de la URL, abre justo el
 * agujero que todo el módulo evita.
 *
 * Tampoco devuelve el `url` interno: solo la URL firmada, que caduca en
 * cinco minutos. El bucket `barber-files` es PRIVADO (ver
 * sql/barber_clientes.sql), así que sin firma no hay foto.
 */
export async function listBarberVisitPhotosVisibleToClient(args: {
  barbershopId: string;
  clientId: string;
  take?: number;
}): Promise<BarberPortalPhoto[]> {
  if (!args.barbershopId || !args.clientId) return [];
  const rows = await prisma.barberVisitPhoto.findMany({
    where: {
      barbershopId: args.barbershopId,
      clientId: args.clientId,
      visibleToClient: true,
    },
    select: PHOTO_SELECT,
    orderBy: { createdAt: "desc" },
    take: Math.min(PHOTOS_MAX_PER_CLIENT, Math.max(1, args.take ?? 40)),
  });
  const signed = await signBarberPhotoPaths(rows.map((r) => r.url));
  return rows.map((row, i) => ({
    id: row.id,
    kind: row.kind,
    appointmentId: row.appointmentId,
    createdAt: row.createdAt.toISOString(),
    signedUrl: signed[i] ?? "",
  }));
}
