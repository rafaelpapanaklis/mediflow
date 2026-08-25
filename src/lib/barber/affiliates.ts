import "server-only";
import { createHash, randomBytes, randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { isBarbershopSubscriptionActive } from "@/lib/barber/plan-shared";
import { getBarberPlan } from "@/lib/barber/plans";
import type {
  BarberAffiliateSummaryDTO,
  BarberAffiliateTermsDTO,
  BarberCommissionDTO,
  BarberIncomingReferralDTO,
  BarberReferralDTO,
} from "@/components/barber/afiliados/shared";

/**
 * DaleControl BARBER — PROGRAMA DE SOCIOS. Punto ÚNICO del vertical: liga,
 * clics, atribución, comisiones y pago. Ninguna ruta inventa su propia
 * regla ni escribe estas tablas por su cuenta.
 *
 * QUÉ ES: una barbería recomienda DaleControl a otra barbería y cobra
 * cuando la referida PAGA. En un gremio donde todos se conocen es el canal
 * más barato de adquisición.
 *
 * ── AISLAMIENTO DEL DENTAL ────────────────────────────────────────────
 * CERO imports de src/lib/affiliates/** (el motor dental, vivo en
 * producción). Se copió el CRITERIO —primer toque, 90 días, dedupe por
 * cookie de navegador y no por IP— y nada del código, igual que
 * barber/billing.ts replicó el patrón de Stripe sin importar
 * src/lib/stripe.ts. Cookies propias (dcb_aff / dcb_vid) para que las dos
 * atribuciones convivan en el mismo navegador sin pisarse.
 *
 * ── DINERO ────────────────────────────────────────────────────────────
 * Todo cálculo en Prisma.Decimal, jamás Float. Los montos y porcentajes
 * salen SIEMPRE de barber_affiliate_config (tabla): ni este módulo ni un
 * componente tienen una cifra escrita. FALLBACK_BARBER_AFFILIATE_CONFIG
 * existe solo para que la app no truene antes de aplicar el SQL, y sus
 * números son los MISMOS del INSERT de sql/barber_afiliados.sql.
 *
 * ── SIN EL SQL APLICADO ───────────────────────────────────────────────
 * Las tablas nacen en sql/barber_afiliados.sql, que Rafael aplica a mano.
 * Mientras no exista, cada lectura devuelve el blocker "SCHEMA_MISSING" y
 * el panel lo dice con todas sus letras; ninguna pantalla, ni el ALTA de
 * una barbería, se cae por esto.
 */

// ═══════════════════════════════════════════════════════════════════════
// 1. Cookies propias del vertical
// ═══════════════════════════════════════════════════════════════════════

/** Atribución de socio. PRIMER TOQUE: si ya existe, no se sobrescribe. */
export const BARBER_AFF_COOKIE = "dcb_aff";
/** 90 días duros — el mismo criterio del dental, para no tener dos reglas. */
export const BARBER_AFF_COOKIE_DAYS = 90;
export const BARBER_AFF_COOKIE_MAX_AGE = BARBER_AFF_COOKIE_DAYS * 24 * 60 * 60;
const AFF_MAX_AGE_MS = BARBER_AFF_COOKIE_MAX_AGE * 1000;

/** Visitante anónimo: SOLO para deduplicar clics. Nada personal dentro. */
export const BARBER_AFF_VISITOR_COOKIE = "dcb_vid";
export const BARBER_AFF_VISITOR_MAX_AGE = 365 * 24 * 60 * 60;

/** Ventana de dedupe: el mismo navegador no vuelve a contar en 30 minutos. */
export const BARBER_AFF_CLICK_DEDUPE_MS = 30 * 60 * 1000;

const AFF_COOKIE_VERSION = "v1";
const VID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Código de liga: 8 chars sin I/O/0/1 (se dicta por teléfono y se imprime). */
export const BARBER_AFF_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const BARBER_AFF_CODE_LENGTH = 8;
export const BARBER_AFF_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export interface BarberAffiliateAttribution {
  code: string;
  /** Epoch ms del PRIMER toque. No se renueva nunca. */
  firstTouchAt: number;
}

/** Normaliza lo que el usuario escribe o pega: mayúsculas y sin espacios. */
export function normalizeBarberAffCode(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return BARBER_AFF_CODE_RE.test(v) ? v : null;
}

/** Serializa la cookie: "v1.<CODE>.<epochMs>". null si el valor no sirve. */
export function packBarberAttribution(value: BarberAffiliateAttribution): string | null {
  const code = normalizeBarberAffCode(value.code);
  if (!code) return null;
  const ts = Number.isFinite(value.firstTouchAt) ? Math.floor(value.firstTouchAt) : 0;
  if (ts <= 0) return null;
  return `${AFF_COOKIE_VERSION}.${code}.${ts}`;
}

/**
 * Parsea el valor crudo. null si viene corrupta, de otra versión o YA
 * EXPIRÓ. La expiración se revalida aquí aunque maxAge la borre en el
 * navegador: una cookie de 91 días que sobreviva (reloj del cliente, un
 * proxy que la reinyecte) NO debe atribuir a nadie.
 */
export function parseBarberAttribution(
  raw: string | null | undefined,
): BarberAffiliateAttribution | null {
  try {
    const value = (raw ?? "").trim();
    if (!value) return null;
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const [version, code, rawTs] = parts;
    if (version !== AFF_COOKIE_VERSION) return null;
    const clean = normalizeBarberAffCode(code);
    if (!clean) return null;
    const firstTouchAt = Number.parseInt(rawTs, 10);
    if (!Number.isFinite(firstTouchAt) || firstTouchAt <= 0) return null;
    const age = Date.now() - firstTouchAt;
    // Una fecha en el futuro es basura, no una cookie eterna.
    if (age > AFF_MAX_AGE_MS || age < -AFF_MAX_AGE_MS) return null;
    return { code: clean, firstTouchAt };
  } catch {
    // Una cookie corrupta jamás puede romper un alta ni una redirección.
    return null;
  }
}

/**
 * Lee UNA cookie del header crudo `Cookie:`. Propio a propósito: el hook
 * del registro recibe el header, no un objeto de Next.
 */
export function readCookieFromHeader(header: string | null | undefined, name: string): string | null {
  const raw = header ?? "";
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

export function newBarberVisitorId(): string {
  return randomUUID();
}

export function parseBarberVisitorId(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return VID_RE.test(v) ? v : null;
}

/** sha256 truncado con sal — jamás se guarda la IP cruda. */
export function hashBarberIp(ip: string | null | undefined): string | null {
  const clean = (ip ?? "").trim();
  if (!clean) return null;
  const salt = process.env.AFFILIATE_IP_SALT ?? process.env.NEXTAUTH_SECRET ?? "dcbarber";
  return createHash("sha256").update(`${salt}:${clean}`).digest("hex").slice(0, 32);
}

/** User-agent resumido: acotado para que no llegue una novela a la BD. */
export function summarizeBarberUserAgent(ua: string | null | undefined): string | null {
  const clean = (ua ?? "").trim();
  return clean ? clean.slice(0, 160) : null;
}

/**
 * Heurística de bot MUY conservadora: solo lo obvio. Un bot igual recibe su
 * redirección y su cookie; solo no suma clic.
 */
export function looksLikeBarberBot(ua: string | null | undefined): boolean {
  const v = (ua ?? "").toLowerCase();
  if (!v) return true;
  return /bot|crawler|spider|crawling|preview|facebookexternalhit|whatsapp|slackbot|telegrambot|bingpreview|headless|curl|wget|python-requests/.test(
    v,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Tablas sin aplicar → degradación elegante
// ═══════════════════════════════════════════════════════════════════════

/**
 * ¿El error es "esa tabla/columna todavía no existe"? P2021/P2022 de Prisma
 * y 42P01/42703 de Postgres. Se usa para degradar, NUNCA para tapar otros
 * errores: cualquier otra cosa se propaga.
 */
export function isBarberAffiliateSchemaMissing(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2021" || err.code === "P2022") return true;
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return false;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("42P01") ||
    msg.includes("42703") ||
    /barber_affiliate_\w+.*does not exist/i.test(msg) ||
    /relation "barber_affiliate/i.test(msg)
  );
}

/**
 * Corre `fn` y, si las tablas del programa no existen todavía, devuelve
 * `fallback` en vez de tumbar la pantalla. Cualquier otro error se propaga:
 * degradar no es tragarse bugs.
 */
async function tolerateMissingSchema<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isBarberAffiliateSchemaMissing(err)) {
      console.warn("[barber afiliados] falta aplicar sql/barber_afiliados.sql");
      return fallback;
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Config del programa (tabla, con caché y fallback)
// ═══════════════════════════════════════════════════════════════════════

export interface BarberAffiliateConfigResolved {
  isEnabled: boolean;
  mode: "fixed" | "pct";
  fixedAmount: Prisma.Decimal;
  percent: Prisma.Decimal;
  currency: string;
  recurring: boolean;
  maxMonths: number;
  holdDays: number;
  minPayout: Prisma.Decimal;
  termsUrl: string | null;
  /** false = la tabla aún no existe (o está vacía): esto es el fallback. */
  fromTable: boolean;
}

/**
 * FALLBACK = SEED. Los MISMOS números que el INSERT de
 * sql/barber_afiliados.sql. No es "la comisión hardcodeada": es lo que la
 * tabla va a decir en cuanto Rafael aplique el SQL, y ahí se edita sin
 * redeploy. Se pinta con el aviso de que falta aplicar el SQL.
 */
export const FALLBACK_BARBER_AFFILIATE_CONFIG: Omit<BarberAffiliateConfigResolved, "fromTable"> = {
  isEnabled: true,
  mode: "fixed",
  fixedAmount: new Prisma.Decimal(500),
  percent: new Prisma.Decimal(0),
  currency: "MXN",
  recurring: false,
  maxMonths: 0,
  holdDays: 30,
  minPayout: new Prisma.Decimal(0),
  termsUrl: null,
};

let configCache: { value: BarberAffiliateConfigResolved; at: number } | null = null;
const CONFIG_TTL_MS = 60_000;

function coerceMode(v: unknown): "fixed" | "pct" {
  return v === "pct" ? "pct" : "fixed";
}

/** Config viva del programa. Nunca lanza: cae al fallback y lo marca. */
export async function getBarberAffiliateConfig(): Promise<BarberAffiliateConfigResolved> {
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_TTL_MS) return configCache.value;

  const fallback: BarberAffiliateConfigResolved = {
    ...FALLBACK_BARBER_AFFILIATE_CONFIG,
    fromTable: false,
  };

  const row = await tolerateMissingSchema(
    () => prisma.barberAffiliateConfig.findUnique({ where: { id: "default" } }),
    null,
  ).catch(() => null);

  const value: BarberAffiliateConfigResolved = row
    ? {
        isEnabled: row.isEnabled,
        mode: coerceMode(row.mode),
        fixedAmount: new Prisma.Decimal(row.fixedAmount),
        percent: new Prisma.Decimal(row.percent),
        currency: row.currency || "MXN",
        recurring: row.recurring,
        maxMonths: Math.max(0, row.maxMonths),
        holdDays: Math.max(0, row.holdDays),
        minPayout: new Prisma.Decimal(row.minPayout),
        termsUrl: row.termsUrl,
        fromTable: true,
      }
    : fallback;

  configCache = { value, at: now };
  return value;
}

/** Invalida la caché (tras editar la fila por SQL o desde un admin futuro). */
export function clearBarberAffiliateConfigCache(): void {
  configCache = null;
}

function termsToDTO(cfg: BarberAffiliateConfigResolved): BarberAffiliateTermsDTO {
  return {
    mode: cfg.mode,
    fixedAmount: money(cfg.fixedAmount),
    percent: money(cfg.percent),
    currency: cfg.currency,
    recurring: cfg.recurring,
    maxMonths: cfg.maxMonths,
    holdDays: cfg.holdDays,
    minPayout: money(cfg.minPayout),
    termsUrl: cfg.termsUrl,
    attributionDays: BARBER_AFF_COOKIE_DAYS,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4. Dinero (Decimal siempre)
// ═══════════════════════════════════════════════════════════════════════

/** Decimal → number con 2 decimales, solo para el DTO. El cálculo fue Decimal. */
function money(d: Prisma.Decimal | number | string): number {
  return Number(new Prisma.Decimal(d).toFixed(2));
}

function sumDecimal(values: Array<Prisma.Decimal | number | string | null>): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const v of values) {
    if (v === null || v === undefined) continue;
    total = total.plus(new Prisma.Decimal(v));
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Cuenta de socio
// ═══════════════════════════════════════════════════════════════════════

function newBarberAffCode(): string {
  const bytes = randomBytes(BARBER_AFF_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < BARBER_AFF_CODE_LENGTH; i++) {
    out += BARBER_AFF_CODE_ALPHABET[bytes[i] % BARBER_AFF_CODE_ALPHABET.length];
  }
  return out;
}

/** La barbería que PAGA y que, por tanto, es el socio: la matriz. */
export function rootBarbershopIdOf(
  ctx: Pick<BarberContext, "barbershopId" | "barbershop">,
): string {
  return ctx.barbershop.parentId ?? ctx.barbershopId;
}

/**
 * Cuenta de socio de la barbería, creándola si no existe. El código se
 * reintenta ante colisión (unique). Devuelve null si el SQL no está
 * aplicado — el llamador lo traduce a blocker, no a error.
 */
export async function ensureBarberAffiliateAccount(barbershopId: string) {
  return tolerateMissingSchema(async () => {
    const existing = await prisma.barberAffiliateAccount.findUnique({ where: { barbershopId } });
    if (existing) return existing;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await prisma.barberAffiliateAccount.create({
          data: { barbershopId, referralCode: newBarberAffCode() },
        });
      } catch (err) {
        // P2002 = choque de unique. Si fue el código, se reintenta; si fue
        // barbershopId, otra petición la creó en paralelo: se lee y ya.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const raced = await prisma.barberAffiliateAccount.findUnique({ where: { barbershopId } });
          if (raced) return raced;
          continue;
        }
        throw err;
      }
    }
    return null;
  }, null);
}

/** Datos de cobro del socio (los captura él, los lee Rafael al pagar). */
export async function saveBarberAffiliatePayout(
  barbershopId: string,
  method: string | null,
  details: string | null,
): Promise<boolean> {
  return tolerateMissingSchema(async () => {
    const account = await ensureBarberAffiliateAccount(barbershopId);
    if (!account) return false;
    await prisma.barberAffiliateAccount.update({
      where: { id: account.id },
      data: {
        payoutMethod: method ? method.trim().slice(0, 80) : null,
        payoutDetails: details ? details.trim().slice(0, 240) : null,
      },
    });
    return true;
  }, false);
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Clics de la liga
// ═══════════════════════════════════════════════════════════════════════

export interface BarberAffiliateLinkTarget {
  accountId: string;
  barbershopId: string;
  code: string;
  isActive: boolean;
}

/** Resuelve el código público a su cuenta. null = código muerto. */
export async function resolveBarberAffiliateCode(
  code: string,
): Promise<BarberAffiliateLinkTarget | null> {
  const clean = normalizeBarberAffCode(code);
  if (!clean) return null;
  return tolerateMissingSchema(async () => {
    const account = await prisma.barberAffiliateAccount.findUnique({
      where: { referralCode: clean },
      select: { id: true, barbershopId: true, referralCode: true, isActive: true },
    });
    if (!account) return null;
    return {
      accountId: account.id,
      barbershopId: account.barbershopId,
      code: account.referralCode,
      isActive: account.isActive,
    };
  }, null);
}

/**
 * Guarda el clic. `counted` decide si suma al embudo: los bots y las
 * repeticiones del mismo navegador dentro de la ventana se guardan con
 * counted=false para poder auditar por qué no contaron.
 *
 * Nunca lanza: un fallo escribiendo métricas no puede romper la redirección
 * de alguien que acaba de tocar un link en WhatsApp.
 */
export async function recordBarberAffiliateClick(args: {
  target: BarberAffiliateLinkTarget;
  vid: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    const isBot = looksLikeBarberBot(args.userAgent);
    let counted = !isBot;

    if (counted && args.vid) {
      const since = new Date(Date.now() - BARBER_AFF_CLICK_DEDUPE_MS);
      const recent = await prisma.barberAffiliateClick.findFirst({
        where: { code: args.target.code, vid: args.vid, createdAt: { gte: since } },
        select: { id: true },
      });
      if (recent) counted = false;
    }

    await prisma.barberAffiliateClick.create({
      data: {
        barbershopId: args.target.barbershopId,
        code: args.target.code,
        vid: args.vid,
        ipHash: hashBarberIp(args.ip),
        userAgent: summarizeBarberUserAgent(args.userAgent),
        counted,
      },
    });
  } catch (err) {
    if (!isBarberAffiliateSchemaMissing(err)) {
      console.error("[barber afiliados] no se pudo registrar el clic", err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 7. Atribución — con los candados de auto-referido
// ═══════════════════════════════════════════════════════════════════════

export type BarberClaimReason =
  | "OK"
  | "NO_COOKIE"
  | "SCHEMA_MISSING"
  | "PROGRAM_DISABLED"
  | "INVALID_CODE"
  | "INACTIVE_ACCOUNT"
  /** La barbería es la dueña de la liga. */
  | "SELF_REFERRAL"
  /** Matriz y sucursal de la MISMA cadena. */
  | "SAME_FAMILY"
  /** Mismo dueño detrás de las dos cuentas (login o correo compartido). */
  | "SAME_OWNER"
  /** A refirió a B y ahora B quiere refererir a A (o más arriba en la cadena). */
  | "CYCLE"
  /** Primer toque gana: esta barbería ya tiene socio. */
  | "ALREADY_ATTRIBUTED";

export interface BarberClaimResult {
  ok: boolean;
  reason: BarberClaimReason;
  referralId?: string;
}

/** Raíz de la cadena de una barbería (ella misma si es matriz). */
async function rootIdOfShop(barbershopId: string): Promise<string> {
  const shop = await prisma.barbershop.findUnique({
    where: { id: barbershopId },
    select: { id: true, parentId: true },
  });
  return shop?.parentId ?? barbershopId;
}

/**
 * ¿Comparten dueño? Dos señales, ambas fuertes:
 *   · un mismo supabaseId con usuario activo en las dos barberías, o
 *   · el mismo correo de contacto en las dos filas Barbershop.
 * Es el candado que impide abrir una segunda cuenta para auto-referirse.
 */
async function shareOwner(aShopId: string, bShopId: string): Promise<boolean> {
  const users = await prisma.barberUser.findMany({
    where: { barbershopId: { in: [aShopId, bShopId] } },
    select: { barbershopId: true, supabaseId: true, email: true },
  });
  const aIds = new Set<string>();
  const bIds = new Set<string>();
  const aMails = new Set<string>();
  const bMails = new Set<string>();
  for (const u of users) {
    const ids = u.barbershopId === aShopId ? aIds : bIds;
    const mails = u.barbershopId === aShopId ? aMails : bMails;
    ids.add(u.supabaseId);
    if (u.email) mails.add(u.email.trim().toLowerCase());
  }
  for (const id of Array.from(aIds)) if (bIds.has(id)) return true;
  for (const mail of Array.from(aMails)) if (bMails.has(mail)) return true;

  const shops = await prisma.barbershop.findMany({
    where: { id: { in: [aShopId, bShopId] } },
    select: { id: true, email: true },
  });
  const mails = shops
    .map((s) => (s.email ?? "").trim().toLowerCase())
    .filter((m) => m.length > 0);
  return mails.length === 2 && mails[0] === mails[1];
}

/**
 * ¿Atribuir `referrer → referred` cerraría un círculo? Sube por la cadena
 * de quién refirió a quién desde el referidor: si en el camino aparece la
 * barbería referida, es un círculo (A→B y B→A, o más largo).
 * Profundidad acotada: una cadena rota jamás debe colgar un alta.
 */
async function closesReferralCycle(
  referrerShopId: string,
  referredShopId: string,
): Promise<boolean> {
  let cursor: string | null = referrerShopId;
  const seen = new Set<string>();
  for (let depth = 0; depth < 10 && cursor; depth++) {
    if (cursor === referredShopId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const up: { barbershopId: string } | null =
      await prisma.barberAffiliateReferral.findUnique({
        where: { referredBarbershopId: cursor },
        select: { barbershopId: true },
      });
    cursor = up?.barbershopId ?? null;
  }
  return false;
}

/**
 * Atribuye la barbería `referredBarbershopId` al socio dueño de `code`.
 * TODOS los candados corren aquí, en el servidor: es el único camino que
 * escribe barber_affiliate_referrals.
 *
 * Idempotente y de PRIMER TOQUE: si la barbería ya tiene socio, no se
 * reasigna nunca (ALREADY_ATTRIBUTED).
 */
export async function claimBarberReferralByCode(args: {
  referredBarbershopId: string;
  code: string;
  firstTouchAt: Date;
}): Promise<BarberClaimResult> {
  const clean = normalizeBarberAffCode(args.code);
  if (!clean) return { ok: false, reason: "INVALID_CODE" };

  const cfg = await getBarberAffiliateConfig();
  if (!cfg.isEnabled) return { ok: false, reason: "PROGRAM_DISABLED" };

  try {
    const target = await prisma.barberAffiliateAccount.findUnique({
      where: { referralCode: clean },
      select: { id: true, barbershopId: true, isActive: true },
    });
    if (!target) return { ok: false, reason: "INVALID_CODE" };
    if (!target.isActive) return { ok: false, reason: "INACTIVE_ACCOUNT" };

    // La barbería referida se atribuye SIEMPRE a nivel de su matriz: si no,
    // abrir una sucursal sería una atribución nueva.
    const referredRootId = await rootIdOfShop(args.referredBarbershopId);
    const referrerRootId = await rootIdOfShop(target.barbershopId);

    // ── Candados ──────────────────────────────────────────────────────
    if (referrerRootId === referredRootId) return { ok: false, reason: "SELF_REFERRAL" };
    if (target.barbershopId === args.referredBarbershopId) {
      return { ok: false, reason: "SELF_REFERRAL" };
    }

    const [referrerShop, referredShop] = await Promise.all([
      prisma.barbershop.findUnique({
        where: { id: referrerRootId },
        select: { id: true, parentId: true },
      }),
      prisma.barbershop.findUnique({
        where: { id: referredRootId },
        select: { id: true, parentId: true },
      }),
    ]);
    if (!referrerShop || !referredShop) return { ok: false, reason: "INVALID_CODE" };
    // Misma cadena por parentId en cualquier sentido.
    if (
      referrerShop.parentId === referredShop.id ||
      referredShop.parentId === referrerShop.id
    ) {
      return { ok: false, reason: "SAME_FAMILY" };
    }

    const existing = await prisma.barberAffiliateReferral.findUnique({
      where: { referredBarbershopId: referredRootId },
      select: { id: true },
    });
    if (existing) return { ok: false, reason: "ALREADY_ATTRIBUTED" };

    if (await shareOwner(referrerRootId, referredRootId)) {
      return { ok: false, reason: "SAME_OWNER" };
    }
    if (await closesReferralCycle(referrerRootId, referredRootId)) {
      return { ok: false, reason: "CYCLE" };
    }

    // ── Escritura ─────────────────────────────────────────────────────
    const created = await prisma.barberAffiliateReferral.create({
      data: {
        barbershopId: referrerRootId,
        accountId: target.id,
        referredBarbershopId: referredRootId,
        code: clean,
        firstTouchAt: args.firstTouchAt,
      },
      select: { id: true },
    });
    return { ok: true, reason: "OK", referralId: created.id };
  } catch (err) {
    // Carrera: dos peticiones atribuyendo la misma barbería a la vez. El
    // unique de referredBarbershopId decide y el perdedor no es un error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "ALREADY_ATTRIBUTED" };
    }
    if (isBarberAffiliateSchemaMissing(err)) return { ok: false, reason: "SCHEMA_MISSING" };
    throw err;
  }
}

/**
 * HOOK DEL ALTA. Lo llama /api/barber/auth/register con el header Cookie
 * crudo, envuelto en try/catch: el registro de una barbería JAMÁS se rompe
 * porque el programa de socios falle.
 *
 * Se llama al crear la barbería, no antes: la comisión se gana cuando la
 * referida paga, pero la atribución se sella aquí, con la fecha del clic.
 */
export async function claimBarberReferral(
  referredBarbershopId: string,
  cookieHeader: string | null | undefined,
): Promise<BarberClaimResult> {
  const attribution = parseBarberAttribution(
    readCookieFromHeader(cookieHeader, BARBER_AFF_COOKIE),
  );
  if (!attribution) return { ok: false, reason: "NO_COOKIE" };
  return claimBarberReferralByCode({
    referredBarbershopId,
    code: attribution.code,
    firstTouchAt: new Date(attribution.firstTouchAt),
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 8. Comisiones — se devengan cuando la referida PAGA
// ═══════════════════════════════════════════════════════════════════════

/** "YYYY-MM" en UTC. Un mes = un cobro; el periodo es de calendario. */
export function barberPeriodKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Cuánto vale esta referida HOY, según la config y el plan que contrató. */
async function commissionAmountFor(
  cfg: BarberAffiliateConfigResolved,
  referredPlan: string,
): Promise<{ amount: Prisma.Decimal; basis: Prisma.InputJsonValue }> {
  if (cfg.mode === "pct") {
    const plan = await getBarberPlan(referredPlan);
    const price = new Prisma.Decimal(plan.priceMonthly);
    const amount = price.times(cfg.percent).dividedBy(100);
    return {
      amount: new Prisma.Decimal(amount.toFixed(2)),
      basis: {
        mode: "pct",
        percent: cfg.percent.toString(),
        planId: plan.id,
        planPriceMonthly: price.toString(),
        holdDays: cfg.holdDays,
      },
    };
  }
  return {
    amount: new Prisma.Decimal(cfg.fixedAmount.toFixed(2)),
    basis: {
      mode: "fixed",
      fixedAmount: cfg.fixedAmount.toString(),
      planId: referredPlan,
      holdDays: cfg.holdDays,
    },
  };
}

/**
 * Materializa el estado del socio: pone al día el estatus de cada referida
 * y GENERA las comisiones que correspondan.
 *
 * Por qué se deriva y no se dispara desde el webhook de Stripe: el webhook
 * del vertical (src/app/api/barber/stripe/webhook) es de la ola de cobro y
 * no se toca desde aquí. Leer el estado real de la referida
 * (subscriptionStatus) es además MÁS robusto: no depende de haber visto un
 * evento, y volver a correr esto mil veces no duplica un peso porque la
 * llave (referredBarbershopId, periodKey) es única.
 */
export async function syncBarberAffiliateState(barbershopId: string): Promise<void> {
  await tolerateMissingSchema(async () => {
    const cfg = await getBarberAffiliateConfig();
    const account = await prisma.barberAffiliateAccount.findUnique({
      where: { barbershopId },
      select: { id: true },
    });
    if (!account) return;

    const referrals = await prisma.barberAffiliateReferral.findMany({
      where: { barbershopId },
      select: {
        id: true,
        referredBarbershopId: true,
        status: true,
        firstPaidAt: true,
      },
    });
    if (referrals.length === 0) return;

    const shops = await prisma.barbershop.findMany({
      where: { id: { in: referrals.map((r) => r.referredBarbershopId) } },
      select: { id: true, plan: true, subscriptionStatus: true },
    });
    const shopById = new Map(shops.map((s) => [s.id, s]));
    const now = new Date();

    // Las comisiones se juntan y se insertan de UNA con skipDuplicates
    // (ON CONFLICT DO NOTHING). Intentar un create por referida y atrapar el
    // P2002 también era idempotente, pero dejaba un `prisma:error` en el log
    // POR CADA carga del panel — la sincronización corre en cada visita.
    const toCreate: Prisma.BarberAffiliateCommissionCreateManyInput[] = [];

    // Cuántas comisiones lleva ya cada referida. En UN solo viaje a la BD
    // (antes era un count por referida dentro del bucle) y sirve para las
    // dos reglas: el tope de meses del recurrente y el "una y solo una"
    // del pago único.
    const counts = await prisma.barberAffiliateCommission.groupBy({
      by: ["referralId"],
      where: { barbershopId },
      _count: { _all: true },
    });
    const commissionsByReferral = new Map(counts.map((c) => [c.referralId, c._count._all]));

    for (const referral of referrals) {
      const shop = shopById.get(referral.referredBarbershopId);
      // Barbería borrada: se deja la fila (es el historial del socio) y no
      // se genera nada nuevo.
      if (!shop) continue;
      const paying = isBarbershopSubscriptionActive(shop);

      // a) Estatus de la referida.
      const nextStatus = paying ? "PAYING" : referral.firstPaidAt ? "CHURNED" : "SIGNED_UP";
      if (nextStatus !== referral.status || (paying && !referral.firstPaidAt)) {
        await prisma.barberAffiliateReferral.update({
          where: { id: referral.id },
          data: {
            status: nextStatus,
            firstPaidAt: referral.firstPaidAt ?? (paying ? now : null),
          },
        });
      }

      // b) Comisión. SOLO si está pagando y el programa está encendido.
      if (!paying || !cfg.isEnabled) continue;

      const periodKey = cfg.recurring ? barberPeriodKey(now) : "signup";
      const already = commissionsByReferral.get(referral.id) ?? 0;

      // PAGO ÚNICO = una comisión por referida y punto. El índice único de
      // (referredBarbershopId, "signup") no basta: si el programa estuvo en
      // recurrente y luego Rafael lo pasa a único, la referida ya tendría
      // filas "YYYY-MM" y le caería ADEMÁS una "signup" — pagándole dos
      // veces por lo mismo.
      if (!cfg.recurring && already > 0) continue;

      // Tope de meses del recurrente. Cuenta TODAS las filas de la referida
      // (incluida una "signup" de cuando el programa era de pago único):
      // el tope es de comisiones, no de meses de calendario.
      if (cfg.recurring && cfg.maxMonths > 0 && already >= cfg.maxMonths) continue;

      const { amount, basis } = await commissionAmountFor(cfg, shop.plan);
      if (amount.lessThanOrEqualTo(0)) continue;

      const availableAt = new Date(now.getTime() + cfg.holdDays * 24 * 60 * 60 * 1000);
      toCreate.push({
        barbershopId,
        accountId: account.id,
        referralId: referral.id,
        referredBarbershopId: referral.referredBarbershopId,
        periodKey,
        amount,
        currency: cfg.currency,
        basis,
        availableAt,
      });
    }

    // La idempotencia la garantiza el índice único
    // (referredBarbershopId, periodKey), no una lectura previa: dos
    // sincronizaciones en paralelo no pueden duplicar un peso.
    if (toCreate.length > 0) {
      await prisma.barberAffiliateCommission.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    // c) Retención cumplida → disponible. PAID solo lo pone Rafael a mano.
    await prisma.barberAffiliateCommission.updateMany({
      where: { barbershopId, status: "PENDING", availableAt: { lte: now } },
      data: { status: "AVAILABLE" },
    });
  }, undefined);
}

// ═══════════════════════════════════════════════════════════════════════
// 9. Lo que ve el panel
// ═══════════════════════════════════════════════════════════════════════

/**
 * El OTRO lado: quién recomendó a ESTA barbería. Se lee para poder decirlo
 * en el panel ("te recomendó X") y para saber si todavía puede escribir un
 * código a mano (misma ventana de 90 días que la cookie).
 */
async function getIncomingReferral(
  barbershopId: string,
  shopCreatedAt: Date,
): Promise<BarberIncomingReferralDTO> {
  return tolerateMissingSchema(async () => {
    const row = await prisma.barberAffiliateReferral.findUnique({
      where: { referredBarbershopId: barbershopId },
      select: { barbershopId: true },
    });
    if (row) {
      const referrer = await prisma.barbershop.findUnique({
        where: { id: row.barbershopId },
        // Solo el nombre: es público y es lo único que hace falta decir.
        select: { name: true },
      });
      return { referredByName: referrer?.name ?? null, canClaim: false };
    }
    const ageMs = Date.now() - new Date(shopCreatedAt).getTime();
    return { referredByName: null, canClaim: ageMs <= AFF_MAX_AGE_MS };
  }, { referredByName: null, canClaim: false });
}

/**
 * Resumen COMPLETO del socio. Filtra SIEMPRE por el barbershopId de la
 * sesión (la matriz): dos barberías jamás se ven las comisiones.
 *
 * De la barbería referida solo salen datos PÚBLICOS (nombre y ciudad, lo
 * mismo que enseña su mini-web /b/<slug>). Nunca su correo, su teléfono,
 * su plan ni el estado de su cobro.
 */
export async function getBarberAffiliateSummary(
  ctx: BarberContext,
): Promise<BarberAffiliateSummaryDTO> {
  const barbershopId = rootBarbershopIdOf(ctx);
  const cfg = await getBarberAffiliateConfig();

  const empty: BarberAffiliateSummaryDTO = {
    blocker: cfg.fromTable ? null : "SCHEMA_MISSING",
    referralCode: null,
    referralPath: null,
    shopName: ctx.barbershop.name,
    terms: termsToDTO(cfg),
    funnel: { clicks: 0, signups: 0, paying: 0 },
    earnings: {
      pending: 0,
      available: 0,
      paid: 0,
      total: 0,
      currency: cfg.currency,
      reachesMinPayout: cfg.minPayout.lessThanOrEqualTo(0),
      missingForMinPayout: money(cfg.minPayout.greaterThan(0) ? cfg.minPayout : 0),
    },
    referrals: [],
    commissions: [],
    payout: { method: null, details: null },
    incoming: { referredByName: null, canClaim: false },
  };

  if (!cfg.isEnabled) return { ...empty, blocker: "PROGRAM_DISABLED" };

  const account = await ensureBarberAffiliateAccount(barbershopId);
  if (!account) return { ...empty, blocker: "SCHEMA_MISSING" };

  await syncBarberAffiliateState(barbershopId);

  return tolerateMissingSchema(async () => {
    const incoming = await getIncomingReferral(barbershopId, ctx.barbershop.createdAt);
    const [clicks, referrals, commissions] = await Promise.all([
      prisma.barberAffiliateClick.count({ where: { barbershopId, counted: true } }),
      prisma.barberAffiliateReferral.findMany({
        where: { barbershopId },
        orderBy: { signedUpAt: "desc" },
        take: 200,
        select: {
          id: true,
          referredBarbershopId: true,
          status: true,
          signedUpAt: true,
          firstPaidAt: true,
        },
      }),
      prisma.barberAffiliateCommission.findMany({
        where: { barbershopId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          referredBarbershopId: true,
          referralId: true,
          periodKey: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          availableAt: true,
          paidAt: true,
          payoutRef: true,
          payoutProofUrl: true,
        },
      }),
    ]);

    const shops = referrals.length
      ? await prisma.barbershop.findMany({
          where: { id: { in: referrals.map((r) => r.referredBarbershopId) } },
          // Solo lo PÚBLICO. Un select explícito, nunca la fila entera.
          select: { id: true, name: true, city: true },
        })
      : [];
    const shopById = new Map(shops.map((s) => [s.id, s]));

    const earnedByReferral = new Map<string, Prisma.Decimal>();
    for (const c of commissions) {
      const prev = earnedByReferral.get(c.referralId) ?? new Prisma.Decimal(0);
      earnedByReferral.set(c.referralId, prev.plus(new Prisma.Decimal(c.amount)));
    }

    const referralDTOs: BarberReferralDTO[] = referrals.map((r) => ({
      id: r.id,
      name: shopById.get(r.referredBarbershopId)?.name ?? "—",
      city: shopById.get(r.referredBarbershopId)?.city ?? null,
      status: r.status,
      signedUpAt: r.signedUpAt.toISOString(),
      firstPaidAt: r.firstPaidAt ? r.firstPaidAt.toISOString() : null,
      earned: money(earnedByReferral.get(r.id) ?? 0),
    }));

    const commissionDTOs: BarberCommissionDTO[] = commissions.map((c) => ({
      id: c.id,
      referredName: shopById.get(c.referredBarbershopId)?.name ?? "—",
      periodKey: c.periodKey,
      amount: money(c.amount),
      currency: c.currency,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      availableAt: c.availableAt.toISOString(),
      paidAt: c.paidAt ? c.paidAt.toISOString() : null,
      payoutRef: c.payoutRef,
      payoutProofUrl: c.payoutProofUrl,
    }));

    const pending = sumDecimal(
      commissions.filter((c) => c.status === "PENDING").map((c) => c.amount),
    );
    const available = sumDecimal(
      commissions.filter((c) => c.status === "AVAILABLE").map((c) => c.amount),
    );
    const paid = sumDecimal(commissions.filter((c) => c.status === "PAID").map((c) => c.amount));

    return {
      blocker: null,
      referralCode: account.referralCode,
      referralPath: barberReferralPath(account.referralCode),
      shopName: ctx.barbershop.name,
      terms: termsToDTO(cfg),
      funnel: {
        clicks,
        signups: referrals.length,
        paying: referrals.filter((r) => r.status === "PAYING").length,
      },
      earnings: {
        pending: money(pending),
        available: money(available),
        paid: money(paid),
        total: money(pending.plus(available).plus(paid)),
        currency: cfg.currency,
        reachesMinPayout:
          cfg.minPayout.lessThanOrEqualTo(0) || available.greaterThanOrEqualTo(cfg.minPayout),
        missingForMinPayout: money(
          cfg.minPayout.greaterThan(available) ? cfg.minPayout.minus(available) : 0,
        ),
      },
      referrals: referralDTOs,
      commissions: commissionDTOs,
      payout: { method: account.payoutMethod, details: account.payoutDetails },
      incoming,
    };
  }, { ...empty, blocker: "SCHEMA_MISSING" });
}

/**
 * Ruta RELATIVA de la liga corta. El origen lo pone el navegador
 * (window.location.origin), igual que el QR de la fila: así funciona en
 * localhost, en el preview de Vercel y en el dominio real sin depender de
 * una variable de entorno que se queda vieja.
 *
 * Vive bajo /api/barber/affiliates a propósito: es una ruta NUEVA dentro
 * del vertical, no la /r/ del dental, que no se toca.
 */
export function barberReferralPath(code: string): string {
  return `/api/barber/affiliates/r/${code}`;
}
