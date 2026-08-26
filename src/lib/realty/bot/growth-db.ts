import "server-only";
/* ═══════════════════════════════════════════════════════════════════════
   DaleControl INMUEBLES — CAPA DE DATOS del área de crecimiento.

   Las tablas de esta ola viven en `sql/realty_growth.sql` y NO en
   `prisma/schema.prisma`: el schema está fuera de la allowlist de esta
   terminal (lo comparten las diez de la Ola 2 y una edición en paralelo se
   pisa). Es el mismo camino que barber recorrió con sql/barber_bot.sql y
   sql/barber_campanas.sql antes de que sus tablas entraran al schema.

   Consecuencias, todas asumidas a propósito:
   · se habla por `$queryRaw` / `$executeRaw` con `Prisma.sql`, siempre
     PARAMETRIZADO (nunca concatenando valores);
   · toda lectura tolera que la tabla NO exista todavía y cae a un default
     seguro — el panel dice "falta aplicar sql/realty_growth.sql" en vez de
     tronar;
   · los ids se generan aquí (no hay `@default(cuid())` en un INSERT raw).

   🔴 EL AISLAMIENTO ES DE LA CONSULTA. No hay RLS en estas tablas: cada
   SELECT, UPDATE y DELETE lleva `"accountId" = ${accountId}` y el
   accountId sale SIEMPRE de la sesión (getRealtyContext), jamás del body.
   ═══════════════════════════════════════════════════════════════════════ */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { mxTenDigits } from "@/lib/phone-mx";
import { classifyRealtyReply } from "@/lib/realty/whatsapp-core";
import {
  DEFAULT_REALTY_BOT_SETTINGS,
  isMissingRealtyGrowthTable,
  normalizeRealtyBotSettings,
  type RealtyBotSettings,
  type RealtyBotSkipReason,
} from "@/lib/realty/bot/core";
import {
  DEFAULT_REALTY_GROWTH_SETTINGS,
  REALTY_CAMPAIGN_DAILY_CAP_MAX,
  REALTY_CAMPAIGN_DAILY_CAP_MIN,
  type RealtyGrowthSettingsDTO,
  type RealtyOptOutDTO,
  type RealtyOptOutScope,
  type RealtyOptOutSource,
} from "@/components/realty/growth/growth-shared";

/** Id para un INSERT raw. TEXT en la base, así que un uuid v4 sirve. */
export function newGrowthId(): string {
  return randomUUID();
}

/** "YYYY-MM-DD" del día de HOY en la zona de la cuenta (no en UTC). */
export function growthDayInTz(now: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "America/Mexico_City",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** { weekday 0-6, minuto del día } en la zona de la cuenta. */
export function growthTzParts(
  now: Date,
  timeZone: string,
): { weekday: number; minuteOfDay: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Mexico_City",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wdName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { weekday: map[wdName] ?? 0, minuteOfDay: (hour % 24) * 60 + minute };
  } catch {
    return { weekday: now.getUTCDay(), minuteOfDay: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
}

function toNumber(v: unknown): number {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ═══════════════════════════════════════════════════════════════════════
   0. ¿YA SE CORRIÓ EL SQL?
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Una sola pregunta barata que responde por TODA el área. Se cachea 30 s:
 * la respuesta solo cambia el día que alguien corre el .sql, y sin caché
 * cada pantalla haría la misma consulta cinco veces.
 */
let storageReadyCache: { at: number; value: boolean } | null = null;
const STORAGE_TTL_MS = 30_000;

export async function realtyGrowthStorageReady(): Promise<boolean> {
  const now = Date.now();
  if (storageReadyCache && now - storageReadyCache.at < STORAGE_TTL_MS) {
    return storageReadyCache.value;
  }
  let value = false;
  try {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS n FROM information_schema.tables
                 WHERE table_name IN ('realty_bot_settings','realty_campaigns',
                                      'realty_screening_requests','realty_affiliates',
                                      'realty_contact_optouts','realty_growth_settings')`,
    );
    value = toNumber(rows?.[0]?.n) >= 6;
  } catch {
    value = false;
  }
  storageReadyCache = { at: now, value };
  return value;
}

/* ═══════════════════════════════════════════════════════════════════════
   1. AJUSTES DE CRECIMIENTO POR CUENTA
   ═══════════════════════════════════════════════════════════════════════ */

export async function getRealtyGrowthSettings(
  accountId: string,
): Promise<RealtyGrowthSettingsDTO> {
  try {
    const rows = await prisma.$queryRaw<
      {
        googleReviewUrl: string | null;
        reviewsEnabled: boolean;
        campaignDailyCap: number;
        priceDropEnabled: boolean;
      }[]
    >(
      Prisma.sql`SELECT "googleReviewUrl", "reviewsEnabled", "campaignDailyCap", "priceDropEnabled"
                 FROM realty_growth_settings WHERE "accountId" = ${accountId} LIMIT 1`,
    );
    const row = rows?.[0];
    if (!row) return { ...DEFAULT_REALTY_GROWTH_SETTINGS };
    return {
      googleReviewUrl: row.googleReviewUrl ?? null,
      reviewsEnabled: row.reviewsEnabled === true,
      campaignDailyCap: toNumber(row.campaignDailyCap),
      priceDropEnabled: row.priceDropEnabled === true,
    };
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/growth] no se pudieron leer los ajustes:", err);
    }
    return { ...DEFAULT_REALTY_GROWTH_SETTINGS };
  }
}

export async function saveRealtyGrowthSettings(
  accountId: string,
  patch: Partial<RealtyGrowthSettingsDTO>,
): Promise<RealtyGrowthSettingsDTO> {
  const current = await getRealtyGrowthSettings(accountId);
  const next: RealtyGrowthSettingsDTO = {
    googleReviewUrl:
      patch.googleReviewUrl === undefined ? current.googleReviewUrl : patch.googleReviewUrl,
    reviewsEnabled:
      patch.reviewsEnabled === undefined ? current.reviewsEnabled : patch.reviewsEnabled === true,
    campaignDailyCap: Math.min(
      REALTY_CAMPAIGN_DAILY_CAP_MAX,
      Math.max(
        REALTY_CAMPAIGN_DAILY_CAP_MIN,
        Math.floor(
          patch.campaignDailyCap === undefined
            ? current.campaignDailyCap
            : Number(patch.campaignDailyCap) || 0,
        ),
      ),
    ),
    priceDropEnabled:
      patch.priceDropEnabled === undefined
        ? current.priceDropEnabled
        : patch.priceDropEnabled === true,
  };
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO realty_growth_settings
                 ("accountId","googleReviewUrl","reviewsEnabled","campaignDailyCap","priceDropEnabled","updatedAt")
               VALUES (${accountId}, ${next.googleReviewUrl}, ${next.reviewsEnabled},
                       ${next.campaignDailyCap}, ${next.priceDropEnabled}, CURRENT_TIMESTAMP)
               ON CONFLICT ("accountId") DO UPDATE SET
                 "googleReviewUrl" = EXCLUDED."googleReviewUrl",
                 "reviewsEnabled"  = EXCLUDED."reviewsEnabled",
                 "campaignDailyCap"= EXCLUDED."campaignDailyCap",
                 "priceDropEnabled"= EXCLUDED."priceDropEnabled",
                 "updatedAt"       = CURRENT_TIMESTAMP`,
  );
  return next;
}

/* ═══════════════════════════════════════════════════════════════════════
   2. CONSENTIMIENTO / BAJA
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * ⭐ EL PUENTE CON EL WHATSAPP QUE YA EXISTE.
 *
 * El webhook (src/lib/realty/whatsapp.ts) ya reconoce "BAJA" — pero lo
 * único que hace hoy es apagar `notifyByWhatsapp` de los perfiles de
 * búsqueda de ese contacto, que es la baja de los avisos de coincidencia y
 * NADA más. Ese archivo está FUERA de la allowlist de esta terminal y no se
 * toca.
 *
 * Así que la baja se DERIVA de los mensajes que el webhook ya guardó:
 * se releen los entrantes recientes, se clasifican con la MISMA función que
 * usa el webhook (`classifyRealtyReply`, importada tal cual — no una copia
 * con otro criterio) y los que dicen baja se materializan en
 * realty_contact_optouts. Se corre ANTES de armar cualquier lista de envío.
 *
 * Es idempotente: el índice único (accountId, phone) hace que releer los
 * mismos mensajes no duplique nada.
 */
export async function syncRealtyOptOutsFromInbound(
  accountId: string,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<number> {
  const sinceDays = Math.min(400, Math.max(1, Math.floor(opts.sinceDays ?? 180)));
  const limit = Math.min(2000, Math.max(1, Math.floor(opts.limit ?? 800)));
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  let rows: { body: string | null; phone: string; contactId: string | null }[] = [];
  try {
    rows = await prisma.$queryRaw<{ body: string | null; phone: string; contactId: string | null }[]>(
      Prisma.sql`SELECT m."body", t."phone", t."contactId"
                 FROM realty_messages m
                 JOIN realty_threads t ON t.id = m."threadId"
                 WHERE m."accountId" = ${accountId}
                   AND m."direction" = 'INBOUND'
                   AND m."createdAt" >= ${since}
                   AND m."body" IS NOT NULL
                 ORDER BY m."createdAt" DESC
                 LIMIT ${limit}`,
    );
  } catch (err) {
    console.error("[realty/growth] no se pudo releer la bandeja para bajas:", err);
    return 0;
  }

  const seen = new Set<string>();
  let written = 0;
  for (const row of rows) {
    const phone = mxTenDigits(row.phone);
    if (!phone || seen.has(phone)) continue;
    if (classifyRealtyReply(row.body ?? "") !== "optOut") continue;
    seen.add(phone);
    const ok = await setRealtyOptOut({
      accountId,
      phone,
      contactId: row.contactId,
      scope: "MARKETING",
      source: "REPLY",
      note: "Escribió BAJA por WhatsApp.",
    });
    if (ok) written += 1;
  }
  return written;
}

export async function setRealtyOptOut(args: {
  accountId: string;
  phone: string;
  contactId?: string | null;
  scope?: RealtyOptOutScope;
  source?: RealtyOptOutSource;
  note?: string | null;
}): Promise<boolean> {
  const phone = mxTenDigits(args.phone);
  if (!phone) return false;
  const scope: RealtyOptOutScope = args.scope === "ALL" ? "ALL" : "MARKETING";
  const source: RealtyOptOutSource =
    args.source === "MANUAL" || args.source === "IMPORT" ? args.source : "REPLY";
  try {
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO realty_contact_optouts
                   (id,"accountId","contactId",phone,scope,source,note,"createdAt","updatedAt")
                 VALUES (${newGrowthId()}, ${args.accountId}, ${args.contactId ?? null}, ${phone},
                         ${scope}, ${source}, ${args.note ?? null},
                         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 ON CONFLICT ("accountId", phone) DO UPDATE SET
                   -- Una baja NUNCA se degrada sola: si ya pidió ALL y llega
                   -- un MARKETING, se queda en ALL.
                   scope = CASE WHEN realty_contact_optouts.scope = 'ALL' THEN 'ALL'
                                ELSE EXCLUDED.scope END,
                   "contactId" = COALESCE(EXCLUDED."contactId", realty_contact_optouts."contactId"),
                   "updatedAt" = CURRENT_TIMESTAMP`,
    );
    return true;
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/growth] no se pudo guardar la baja:", err);
    }
    return false;
  }
}

/** Reactivar a alguien. Solo desde el panel y a petición de la persona. */
export async function clearRealtyOptOut(accountId: string, phone: string): Promise<boolean> {
  const p = mxTenDigits(phone);
  if (!p) return false;
  try {
    const n = await prisma.$executeRaw(
      Prisma.sql`DELETE FROM realty_contact_optouts
                 WHERE "accountId" = ${accountId} AND phone = ${p}`,
    );
    return toNumber(n) > 0;
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/growth] no se pudo quitar la baja:", err);
    }
    return false;
  }
}

/**
 * 🔴 LA PREGUNTA QUE SE HACE ANTES DE CADA ENVÍO.
 *
 * FALLA CERRADO: si la tabla no existe o la consulta truena, devuelve
 * `true` (= tratar como dado de baja). Un "no pude comprobar" que deja
 * pasar el mensaje es exactamente cómo se tumba un número de WhatsApp.
 */
export async function isRealtyOptedOut(
  accountId: string,
  phone: string,
  scope: RealtyOptOutScope = "MARKETING",
): Promise<boolean> {
  const p = mxTenDigits(phone);
  if (!p) return true;
  try {
    const rows = await prisma.$queryRaw<{ scope: string }[]>(
      Prisma.sql`SELECT scope FROM realty_contact_optouts
                 WHERE "accountId" = ${accountId} AND phone = ${p} LIMIT 1`,
    );
    const found = rows?.[0]?.scope;
    if (!found) return false;
    // Una baja de MARKETING no frena un mensaje de servicio; una de ALL sí.
    return scope === "MARKETING" ? true : found === "ALL";
  } catch (err) {
    console.error("[realty/growth] no se pudo comprobar la baja (se asume baja):", err);
    return true;
  }
}

/**
 * Versión en bloque para armar una lista: devuelve el conjunto de teléfonos
 * dados de baja. Mismo criterio de fallar cerrado — si truena, devuelve
 * TODOS los teléfonos como dados de baja y la campaña sale vacía.
 */
export async function realtyOptedOutPhones(
  accountId: string,
  phones: string[],
): Promise<Set<string>> {
  const clean = Array.from(
    new Set(phones.map((p) => mxTenDigits(p)).filter((p): p is string => Boolean(p))),
  );
  if (clean.length === 0) return new Set();
  try {
    const rows = await prisma.$queryRaw<{ phone: string }[]>(
      Prisma.sql`SELECT phone FROM realty_contact_optouts
                 WHERE "accountId" = ${accountId} AND phone IN (${Prisma.join(clean)})`,
    );
    return new Set(rows.map((r) => r.phone));
  } catch (err) {
    console.error("[realty/growth] no se pudieron leer las bajas (se asumen todas):", err);
    return new Set(clean);
  }
}

export async function listRealtyOptOuts(
  accountId: string,
  limit = 200,
): Promise<RealtyOptOutDTO[]> {
  try {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        contactId: string | null;
        contactName: string | null;
        phone: string;
        scope: string;
        source: string;
        note: string | null;
        createdAt: Date;
      }[]
    >(
      Prisma.sql`SELECT o.id, o."contactId", c.name AS "contactName", o.phone,
                        o.scope, o.source, o.note, o."createdAt"
                 FROM realty_contact_optouts o
                 LEFT JOIN realty_contacts c ON c.id = o."contactId"
                 WHERE o."accountId" = ${accountId}
                 ORDER BY o."createdAt" DESC
                 LIMIT ${Math.min(500, Math.max(1, limit))}`,
    );
    return rows.map((r) => ({
      id: r.id,
      contactId: r.contactId,
      contactName: r.contactName,
      phone: r.phone,
      scope: (r.scope === "ALL" ? "ALL" : "MARKETING") as RealtyOptOutScope,
      source: (["REPLY", "MANUAL", "IMPORT"].includes(r.source)
        ? r.source
        : "REPLY") as RealtyOptOutSource,
      note: r.note,
      createdAt: toIso(r.createdAt) ?? new Date().toISOString(),
    }));
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/growth] no se pudieron listar las bajas:", err);
    }
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   3. BOT — configuración, gasto, pausas y bitácora
   ═══════════════════════════════════════════════════════════════════════ */

const BOT_SETTINGS_TTL_MS = 20_000;
const botSettingsCache = new Map<string, { at: number; value: RealtyBotSettings }>();

export async function getRealtyBotSettings(accountId: string): Promise<RealtyBotSettings> {
  const hit = botSettingsCache.get(accountId);
  if (hit && Date.now() - hit.at < BOT_SETTINGS_TTL_MS) return hit.value;

  let value: RealtyBotSettings;
  try {
    const rows = await prisma.$queryRaw<
      { enabled: boolean; aiDailyCapMxn: number; settings: unknown }[]
    >(
      Prisma.sql`SELECT enabled, "aiDailyCapMxn", settings
                 FROM realty_bot_settings WHERE "accountId" = ${accountId} LIMIT 1`,
    );
    const row = rows?.[0];
    // Las DOS columnas de verdad (encendido y tope) mandan sobre el jsonb:
    // el blob es configuración de tono, no de dinero.
    const blob = (row?.settings ?? null) as Record<string, unknown> | null;
    value = normalizeRealtyBotSettings({
      ...(blob ?? {}),
      enabled: row?.enabled === true,
      aiDailyCapMxn: row ? toNumber(row.aiDailyCapMxn) : DEFAULT_REALTY_BOT_SETTINGS.aiDailyCapMxn,
    });
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudo leer la configuración:", err);
    }
    // Sin almacenamiento el bot queda APAGADO. Nunca al revés.
    value = normalizeRealtyBotSettings(null);
  }
  botSettingsCache.set(accountId, { at: Date.now(), value });
  return value;
}

export async function saveRealtyBotSettings(
  accountId: string,
  next: RealtyBotSettings,
  byUserId: string | null,
): Promise<RealtyBotSettings> {
  const clean = normalizeRealtyBotSettings(next);
  const blob = {
    tone: clean.tone,
    botName: clean.botName,
    notes: clean.notes,
    abilities: clean.abilities,
    hours: clean.hours,
    maxRepliesPerContactPerDay: clean.maxRepliesPerContactPerDay,
  };
  await prisma.$executeRaw(
    Prisma.sql`INSERT INTO realty_bot_settings
                 ("accountId", enabled, "aiDailyCapMxn", settings, "updatedByUserId","createdAt","updatedAt")
               VALUES (${accountId}, ${clean.enabled}, ${clean.aiDailyCapMxn},
                       ${JSON.stringify(blob)}::jsonb, ${byUserId},
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT ("accountId") DO UPDATE SET
                 enabled = EXCLUDED.enabled,
                 "aiDailyCapMxn" = EXCLUDED."aiDailyCapMxn",
                 settings = EXCLUDED.settings,
                 "updatedByUserId" = EXCLUDED."updatedByUserId",
                 "updatedAt" = CURRENT_TIMESTAMP`,
  );
  botSettingsCache.delete(accountId);
  return clean;
}

/**
 * Gasto de IA de HOY, en micros.
 *
 * 🔴 FALLA CERRADO: si no se puede leer, devuelve Infinity. Devolver 0
 * dejaría la IA sin freno — sin almacenamiento, no se gasta.
 */
export async function readRealtyBotSpendMicros(accountId: string, day: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ costMicros: bigint }[]>(
      Prisma.sql`SELECT "costMicros" FROM realty_bot_spend
                 WHERE "accountId" = ${accountId} AND day = ${day}::date LIMIT 1`,
    );
    return toNumber(rows?.[0]?.costMicros ?? 0);
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudo leer el gasto de IA:", err);
    }
    return Number.POSITIVE_INFINITY;
  }
}

export async function readRealtyBotTurnsToday(accountId: string, day: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ turns: number }[]>(
      Prisma.sql`SELECT turns FROM realty_bot_spend
                 WHERE "accountId" = ${accountId} AND day = ${day}::date LIMIT 1`,
    );
    return toNumber(rows?.[0]?.turns ?? 0);
  } catch {
    return 0;
  }
}

/** Acumulación ATÓMICA: un solo INSERT … ON CONFLICT DO UPDATE SET x = x + n. */
export async function addRealtyBotSpend(
  accountId: string,
  day: string,
  micros: number,
): Promise<void> {
  if (!Number.isFinite(micros) || micros < 0) return;
  const add = Math.round(micros);
  try {
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO realty_bot_spend ("accountId", day, "costMicros", turns, "updatedAt")
                 VALUES (${accountId}, ${day}::date, ${add}::bigint, 1, CURRENT_TIMESTAMP)
                 ON CONFLICT ("accountId", day) DO UPDATE SET
                   "costMicros" = realty_bot_spend."costMicros" + EXCLUDED."costMicros",
                   turns = realty_bot_spend.turns + 1,
                   "updatedAt" = CURRENT_TIMESTAMP`,
    );
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudo registrar el gasto de IA:", err);
    }
  }
}

export async function pauseRealtyBotThread(args: {
  accountId: string;
  phone: string;
  reason: string | null;
}): Promise<void> {
  const phone = mxTenDigits(args.phone);
  if (!phone) return;
  try {
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO realty_bot_pauses ("accountId", phone, reason, "pausedAt")
                 VALUES (${args.accountId}, ${phone}, ${args.reason}, CURRENT_TIMESTAMP)
                 ON CONFLICT ("accountId", phone) DO NOTHING`,
    );
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudo pausar el hilo:", err);
    }
  }
}

export async function resumeRealtyBotThread(accountId: string, phone: string): Promise<boolean> {
  const p = mxTenDigits(phone);
  if (!p) return false;
  try {
    const n = await prisma.$executeRaw(
      Prisma.sql`DELETE FROM realty_bot_pauses WHERE "accountId" = ${accountId} AND phone = ${p}`,
    );
    return toNumber(n) > 0;
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudo reanudar el hilo:", err);
    }
    return false;
  }
}

/** 🔴 FALLA CERRADO: si no se puede comprobar, se considera PAUSADO. */
export async function isRealtyBotThreadPaused(accountId: string, phone: string): Promise<boolean> {
  const p = mxTenDigits(phone);
  if (!p) return true;
  try {
    const rows = await prisma.$queryRaw<{ phone: string }[]>(
      Prisma.sql`SELECT phone FROM realty_bot_pauses
                 WHERE "accountId" = ${accountId} AND phone = ${p} LIMIT 1`,
    );
    return (rows?.length ?? 0) > 0;
  } catch (err) {
    console.error("[realty/bot] no se pudo comprobar la pausa (se asume pausado):", err);
    return true;
  }
}

export async function listRealtyBotPauses(
  accountId: string,
  limit = 100,
): Promise<{ phone: string; reason: string | null; pausedAt: string }[]> {
  try {
    const rows = await prisma.$queryRaw<{ phone: string; reason: string | null; pausedAt: Date }[]>(
      Prisma.sql`SELECT phone, reason, "pausedAt" FROM realty_bot_pauses
                 WHERE "accountId" = ${accountId}
                 ORDER BY "pausedAt" DESC LIMIT ${Math.min(300, Math.max(1, limit))}`,
    );
    return rows.map((r) => ({
      phone: r.phone,
      reason: r.reason,
      pausedAt: toIso(r.pausedAt) ?? new Date().toISOString(),
    }));
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudieron listar las pausas:", err);
    }
    return [];
  }
}

export interface RealtyBotTurnLog {
  accountId: string;
  threadId: string | null;
  contactId: string | null;
  leadId: string | null;
  phone: string;
  inboundBody: string | null;
  outboundBody: string | null;
  skipReason: RealtyBotSkipReason | null;
  handoff: boolean;
  handoffReason: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  extracted: unknown;
}

export async function logRealtyBotTurn(entry: RealtyBotTurnLog): Promise<string | null> {
  const id = newGrowthId();
  try {
    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO realty_bot_turns
                   (id,"accountId","threadId","contactId","leadId",phone,"inboundBody","outboundBody",
                    "skipReason",handoff,"handoffReason",model,"inputTokens","outputTokens",
                    "costMicros",extracted,"createdAt")
                 VALUES (${id}, ${entry.accountId}, ${entry.threadId}, ${entry.contactId},
                         ${entry.leadId}, ${mxTenDigits(entry.phone) ?? entry.phone},
                         ${entry.inboundBody}, ${entry.outboundBody}, ${entry.skipReason},
                         ${entry.handoff}, ${entry.handoffReason}, ${entry.model},
                         ${Math.max(0, Math.round(entry.inputTokens || 0))},
                         ${Math.max(0, Math.round(entry.outputTokens || 0))},
                         ${Math.max(0, Math.round(entry.costMicros || 0))}::bigint,
                         ${entry.extracted ? JSON.stringify(entry.extracted) : null}::jsonb,
                         CURRENT_TIMESTAMP)`,
    );
    return id;
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudo registrar el turno:", err);
    }
    return null;
  }
}

/** Cuántas veces contestó el bot HOY a ESTE teléfono. */
export async function countRealtyBotRepliesToday(
  accountId: string,
  phone: string,
  day: string,
  timeZone: string,
): Promise<number> {
  const p = mxTenDigits(phone);
  if (!p) return 0;
  try {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS n FROM realty_bot_turns
                 WHERE "accountId" = ${accountId}
                   AND phone = ${p}
                   AND "outboundBody" IS NOT NULL
                   AND ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date = ${day}::date`,
    );
    return toNumber(rows?.[0]?.n ?? 0);
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudieron contar las respuestas del día:", err);
    }
    return 0;
  }
}

export async function listRealtyBotTurns(
  accountId: string,
  limit = 60,
): Promise<
  {
    id: string;
    phone: string;
    contactName: string | null;
    inboundBody: string | null;
    outboundBody: string | null;
    skipReason: string | null;
    handoff: boolean;
    handoffReason: string | null;
    costMicros: number;
    correctedBody: string | null;
    correctedAt: string | null;
    createdAt: string;
  }[]
> {
  try {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        phone: string;
        contactName: string | null;
        inboundBody: string | null;
        outboundBody: string | null;
        skipReason: string | null;
        handoff: boolean;
        handoffReason: string | null;
        costMicros: bigint;
        correctedBody: string | null;
        correctedAt: Date | null;
        createdAt: Date;
      }[]
    >(
      Prisma.sql`SELECT b.id, b.phone, c.name AS "contactName", b."inboundBody", b."outboundBody",
                        b."skipReason", b.handoff, b."handoffReason", b."costMicros",
                        b."correctedBody", b."correctedAt", b."createdAt"
                 FROM realty_bot_turns b
                 LEFT JOIN realty_contacts c ON c.id = b."contactId"
                 WHERE b."accountId" = ${accountId}
                 ORDER BY b."createdAt" DESC
                 LIMIT ${Math.min(200, Math.max(1, limit))}`,
    );
    return rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      contactName: r.contactName,
      inboundBody: r.inboundBody,
      outboundBody: r.outboundBody,
      skipReason: r.skipReason,
      handoff: r.handoff === true,
      handoffReason: r.handoffReason,
      costMicros: toNumber(r.costMicros),
      correctedBody: r.correctedBody,
      correctedAt: toIso(r.correctedAt),
      createdAt: toIso(r.createdAt) ?? new Date().toISOString(),
    }));
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudieron listar los turnos:", err);
    }
    return [];
  }
}

/**
 * La corrección que escribe una persona sobre lo que contestó el bot.
 *
 * 🔴 NO pisa `outboundBody`. Lo que se mandó, se mandó: borrarlo haría
 * imposible entender por qué el bot dijo lo que dijo, y esa bitácora es lo
 * único que convence a un dueño de dejarlo encendido. La corrección se
 * guarda AL LADO, y es lo que alimenta las notas del prompt.
 */
export async function correctRealtyBotTurn(args: {
  accountId: string;
  turnId: string;
  correctedBody: string;
  byUserId: string | null;
}): Promise<boolean> {
  const text = String(args.correctedBody ?? "").trim().slice(0, 2000);
  if (!text) return false;
  try {
    const n = await prisma.$executeRaw(
      Prisma.sql`UPDATE realty_bot_turns
                 SET "correctedBody" = ${text}, "correctedById" = ${args.byUserId},
                     "correctedAt" = CURRENT_TIMESTAMP
                 WHERE id = ${args.turnId} AND "accountId" = ${args.accountId}`,
    );
    return toNumber(n) > 0;
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudo guardar la corrección:", err);
    }
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   4. TOPE DIARIO DE CAMPAÑAS
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Cuántos mensajes de campaña salieron HOY (zona de la cuenta).
 *
 * 🔴 FALLA CERRADO devolviendo Infinity: si no se puede contar, no se
 * manda. Un tope que se cae en silencio no es un tope.
 */
export async function countRealtyCampaignSentToday(
  accountId: string,
  day: string,
  timeZone: string,
): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS n FROM realty_campaign_recipients
                 WHERE "accountId" = ${accountId}
                   AND status = 'ENVIADO'
                   AND "sentAt" IS NOT NULL
                   AND ("sentAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date = ${day}::date`,
    );
    return toNumber(rows?.[0]?.n ?? 0);
  } catch (err) {
    if (isMissingRealtyGrowthTable(err)) return 0;
    console.error("[realty/growth] no se pudo contar el envío del día:", err);
    return Number.POSITIVE_INFINITY;
  }
}

/** Último envío de campaña a ESTE teléfono, para respetar el descanso. */
export async function lastRealtyCampaignSentAt(
  accountId: string,
  phones: string[],
): Promise<Map<string, Date>> {
  const clean = Array.from(
    new Set(phones.map((p) => mxTenDigits(p)).filter((p): p is string => Boolean(p))),
  );
  const out = new Map<string, Date>();
  if (clean.length === 0) return out;
  try {
    const rows = await prisma.$queryRaw<{ phone: string; last: Date }[]>(
      Prisma.sql`SELECT phone, max("sentAt") AS last
                 FROM realty_campaign_recipients
                 WHERE "accountId" = ${accountId}
                   AND status = 'ENVIADO'
                   AND phone IN (${Prisma.join(clean)})
                 GROUP BY phone`,
    );
    for (const r of rows) {
      if (r.last) out.set(r.phone, r.last instanceof Date ? r.last : new Date(String(r.last)));
    }
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/growth] no se pudo leer el último envío:", err);
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   5. LO QUE EL BOT LOGRÓ — las visitas que apartó
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Visitas que agendó EL BOT.
 *
 * La prueba de que el bot sirve no es cuántas veces contestó: es cuántas
 * visitas apartó mientras nadie del equipo estaba. Se reconocen porque el
 * turno guardó su `visitId` dentro de `extracted` (ver runRealtyBotAndReply)
 * y se cruzan contra realty_visits para traer el estado de HOY — una visita
 * que el bot apartó y una persona canceló tiene que verse cancelada.
 *
 * El JOIN va contra la tabla de visitas por el cliente tipado y no por raw
 * a propósito: `realty_visits` SÍ está en prisma/schema.prisma desde la Ola
 * 0 y no depende de que este .sql se haya aplicado.
 */
export async function listRealtyBotVisits(
  accountId: string,
  limit = 20,
): Promise<
  {
    id: string;
    propertyTitle: string;
    contactName: string | null;
    scheduledAt: string;
    status: string;
  }[]
> {
  let ids: string[] = [];
  try {
    const rows = await prisma.$queryRaw<{ visitId: string }[]>(
      Prisma.sql`SELECT DISTINCT extracted->>'visitId' AS "visitId"
                 FROM realty_bot_turns
                 WHERE "accountId" = ${accountId}
                   -- Sin el operador `?` de jsonb a propósito: en una
                   -- plantilla Prisma.sql un `?` suelto es ambiguo con los
                   -- marcadores del driver. `->>` devuelve NULL cuando la
                   -- llave no está, así que esto basta.
                   AND extracted->>'visitId' IS NOT NULL
                 ORDER BY 1
                 LIMIT ${Math.min(100, Math.max(1, limit))}`,
    );
    ids = rows.map((r) => r.visitId).filter(Boolean);
  } catch (err) {
    if (!isMissingRealtyGrowthTable(err)) {
      console.error("[realty/bot] no se pudieron leer las visitas del bot:", err);
    }
    return [];
  }
  if (ids.length === 0) return [];

  try {
    const visits = await prisma.realtyVisit.findMany({
      // El accountId se repite aunque los ids ya salieron de esta cuenta:
      // el aislamiento es de LA CONSULTA, no de quien la arma.
      where: { accountId, id: { in: ids } },
      orderBy: { scheduledAt: "desc" },
      take: Math.min(100, Math.max(1, limit)),
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        property: { select: { title: true } },
        lead: { select: { contact: { select: { name: true } } } },
      },
    });
    return visits.map((v) => ({
      id: v.id,
      propertyTitle: v.property?.title ?? "—",
      contactName: v.lead?.contact?.name ?? null,
      scheduledAt: toIso(v.scheduledAt) ?? new Date().toISOString(),
      status: String(v.status),
    }));
  } catch (err) {
    console.error("[realty/bot] no se pudieron leer las visitas:", err);
    return [];
  }
}
