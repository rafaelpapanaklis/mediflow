// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — CONFIGURACIÓN de la barbería (/barber/configuracion).
//
// Todo lo que hasta hoy no se podía tocar desde ningún lado: los datos del
// negocio (nombre, teléfono, dirección, zona horaria, logo), la dirección
// de su página pública (slug), la fidelidad, la inactividad, el descanso
// entre campañas y si la reserva en línea se confirma sola.
//
// ── DÓNDE VIVE CADA AJUSTE (y por qué no se duplica) ─────────────────
// · Datos del negocio y slug → columnas normales de Barbershop (Prisma).
// · Fidelidad e inactividad  → columnas sueltas de barber_shops que YA lee
//   y escribe src/lib/barber/clients.ts con $queryRaw (sql/barber_clientes).
//   Se REUSAN getBarberClientsConfig / saveBarberClientsConfig: un segundo
//   lector de esas columnas sería una segunda verdad.
// · Descanso entre campañas → igual, pero en src/lib/barber/campaigns.ts
//   (sql/barber_campanas). Se reusa getBarberCampaignConfig / save…
// · Política de reserva → columna suelta `bookingPolicy` de barber_shops
//   (sql/barber_settings.sql), leída aquí y en resolveBookingPolicy
//   (booking.ts). Antes se leía del Json de la mini-web, que su editor
//   borra al guardar; por eso tiene columna propia.
//
// Cada bloque sabe si su SQL está aplicado (`persisted`) y la pantalla lo
// dice sección por sección, en vez de fallar entera.
//
// barbershopId sale SIEMPRE del contexto. Un `undefined` en un where de
// Prisma borra el filtro de tenant: aquí cada query lo escribe literal.
// ═══════════════════════════════════════════════════════════════════════
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertBarberPermission, type BarberContext } from "@/lib/barber-auth";
import { makeBarberSlug } from "@/lib/barber/types";
import {
  BARBER_BRANCH_ADDRESS_MAX,
  BarberAdminError,
  cleanText,
} from "@/lib/barber/branches";
import {
  INACTIVE_DAYS_MAX,
  INACTIVE_DAYS_MIN,
  LOYALTY_THRESHOLD_MAX,
  LOYALTY_THRESHOLD_MIN,
  getBarberClientsConfig,
  saveBarberClientsConfig,
} from "@/lib/barber/clients";
import {
  CAMPAIGN_COOLDOWN_MAX,
  CAMPAIGN_COOLDOWN_MIN,
  getBarberCampaignConfig,
  saveBarberCampaignConfig,
} from "@/lib/barber/campaigns";
import type { BarberBookingPolicy } from "@/lib/barber/booking";

// ── Límites ─────────────────────────────────────────────────────────────
export const SHOP_NAME_MAX = 120;
export const SHOP_PHONE_MAX = 20;
export const SHOP_EMAIL_MAX = 120;
export const SHOP_CITY_MAX = 80;
export const SHOP_TIMEZONE_MAX = 60;
export const LOYALTY_REWARD_MAX = 60;
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/**
 * Zonas horarias que se ofrecen en el selector (las de México, que es donde
 * vende el producto). Es la misma lista que usa /barber/sucursales. Si la
 * barbería ya tiene otra zona válida (IANA), se conserva y se muestra.
 */
export const BARBER_TIMEZONES: string[] = [
  "America/Mexico_City",
  "America/Monterrey",
  "America/Cancun",
  "America/Merida",
  "America/Chihuahua",
  "America/Mazatlan",
  "America/Hermosillo",
  "America/Tijuana",
];

/**
 * Slugs que no puede tomar una barbería. Bajo /b/ no chocan con ninguna
 * ruta, pero como nombres de página pública prestan a confusión (parecen del
 * producto) y una barbería "admin" o "api" no es una barbería.
 */
export const RESERVED_SLUGS: string[] = [
  "admin",
  "api",
  "b",
  "barberias",
  "dalecontrol",
  "login",
  "registro",
  "reservar",
  "mi-cuenta",
  "portal",
  "www",
];

// ── Vista que consume la pantalla ───────────────────────────────────────

/** Datos del negocio: SOLO los campos editables. Nada de tokens ni Stripe. */
export interface BarberShopProfile {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  timezone: string;
  logoUrl: string | null;
  /** Nombre corto de la sede (solo informativo aquí; se edita en Sucursales). */
  branchName: string | null;
  isMainBranch: boolean;
}

export interface BarberSettingsView {
  profile: BarberShopProfile;
  slug: string;
  loyalty: {
    enabled: boolean;
    threshold: number;
    reward: string;
    /** false = falta sql/barber_clientes.sql. */
    persisted: boolean;
    min: number;
    max: number;
    rewardMax: number;
  };
  inactivity: {
    days: number;
    persisted: boolean;
    min: number;
    max: number;
  };
  campaigns: {
    cooldownDays: number;
    /** false = falta sql/barber_campanas.sql. */
    persisted: boolean;
    min: number;
    max: number;
  };
  booking: {
    policy: BarberBookingPolicy;
    /** false = falta sql/barber_settings.sql. */
    persisted: boolean;
  };
  timezones: string[];
  limits: {
    name: number;
    phone: number;
    email: number;
    address: number;
    city: number;
    slugMin: number;
    slugMax: number;
  };
}

const PROFILE_SELECT = {
  name: true,
  slug: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  state: true,
  timezone: true,
  logoUrl: true,
  branchName: true,
  isMainBranch: true,
} as const;

async function readProfile(ctx: BarberContext): Promise<BarberShopProfile & { slug: string }> {
  const row = await prisma.barbershop.findUnique({
    where: { id: ctx.barbershopId },
    select: PROFILE_SELECT,
  });
  if (!row) throw new BarberAdminError("No encontramos tu barbería.", 404);
  return row;
}

// ── Política de reserva (columna suelta) ────────────────────────────────

/** Recuerda, por proceso, que la columna no existe todavía (ver clients.ts). */
let bookingColumnMissing = false;

function isMissingColumnError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = e.meta as { code?: unknown } | undefined;
    if (meta && String(meta.code) === "42703") return true;
  }
  return e instanceof Error && /42703|does not exist|no existe la columna/i.test(e.message);
}

export function isBookingPolicy(v: unknown): v is BarberBookingPolicy {
  return v === "manual" || v === "auto";
}

export async function readBookingPolicySetting(
  ctx: BarberContext,
): Promise<{ policy: BarberBookingPolicy; persisted: boolean }> {
  const fallback = { policy: "manual" as BarberBookingPolicy, persisted: false };
  if (bookingColumnMissing) return fallback;
  const barbershopId = ctx.barbershopId;
  try {
    const rows = await prisma.$queryRaw<Array<{ bookingPolicy: string | null }>>`
      SELECT "bookingPolicy" FROM "barber_shops" WHERE "id" = ${barbershopId} LIMIT 1
    `;
    const v = rows[0]?.bookingPolicy;
    return { policy: isBookingPolicy(v) ? v : "manual", persisted: true };
  } catch (e) {
    if (isMissingColumnError(e)) {
      bookingColumnMissing = true;
      return fallback;
    }
    console.warn("[barber/settings] no se pudo leer bookingPolicy:", (e as Error).message);
    return fallback;
  }
}

export interface SaveSettingResult<T> {
  ok: boolean;
  /** "sql_pendiente" = falta aplicar el SQL de esa sección. */
  reason?: "sql_pendiente" | "error";
  value: T;
}

export async function saveBookingPolicy(
  ctx: BarberContext,
  raw: unknown,
): Promise<SaveSettingResult<BarberBookingPolicy>> {
  assertBarberPermission(ctx, "settings.edit");
  if (!isBookingPolicy(raw)) {
    throw new BarberAdminError("La política de reserva tiene que ser «auto» o «manual».");
  }
  const current = await readBookingPolicySetting(ctx);
  if (bookingColumnMissing || !current.persisted) {
    return { ok: false, reason: "sql_pendiente", value: current.policy };
  }
  const barbershopId = ctx.barbershopId;
  try {
    await prisma.$executeRaw`
      UPDATE "barber_shops" SET "bookingPolicy" = ${raw} WHERE "id" = ${barbershopId}
    `;
    return { ok: true, value: raw };
  } catch (e) {
    if (isMissingColumnError(e)) {
      bookingColumnMissing = true;
      return { ok: false, reason: "sql_pendiente", value: current.policy };
    }
    console.warn("[barber/settings] no se pudo guardar bookingPolicy:", (e as Error).message);
    return { ok: false, reason: "error", value: current.policy };
  }
}

// ── Lectura completa ────────────────────────────────────────────────────

export async function getBarberSettings(ctx: BarberContext): Promise<BarberSettingsView> {
  assertBarberPermission(ctx, "settings.edit");
  const [profile, clients, campaigns, booking] = await Promise.all([
    readProfile(ctx),
    getBarberClientsConfig(ctx),
    getBarberCampaignConfig(ctx),
    readBookingPolicySetting(ctx),
  ]);
  const { slug, ...rest } = profile;
  return {
    profile: rest,
    slug,
    loyalty: {
      enabled: clients.loyaltyEnabled,
      threshold: clients.loyaltyThreshold,
      reward: clients.loyaltyReward,
      persisted: clients.persisted,
      min: LOYALTY_THRESHOLD_MIN,
      max: LOYALTY_THRESHOLD_MAX,
      rewardMax: LOYALTY_REWARD_MAX,
    },
    inactivity: {
      days: clients.inactiveDays,
      persisted: clients.persisted,
      min: INACTIVE_DAYS_MIN,
      max: INACTIVE_DAYS_MAX,
    },
    campaigns: {
      cooldownDays: campaigns.cooldownDays,
      persisted: campaigns.persisted,
      min: CAMPAIGN_COOLDOWN_MIN,
      max: CAMPAIGN_COOLDOWN_MAX,
    },
    booking,
    timezones: BARBER_TIMEZONES.includes(profile.timezone)
      ? BARBER_TIMEZONES
      : [profile.timezone, ...BARBER_TIMEZONES],
    limits: {
      name: SHOP_NAME_MAX,
      phone: SHOP_PHONE_MAX,
      email: SHOP_EMAIL_MAX,
      address: BARBER_BRANCH_ADDRESS_MAX,
      city: SHOP_CITY_MAX,
      slugMin: SLUG_MIN,
      slugMax: SLUG_MAX,
    },
  };
}

// ── Datos del negocio ───────────────────────────────────────────────────

export interface ProfileInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  timezone?: unknown;
}

/** ¿Es una zona IANA que este runtime conoce? (Intl la rechaza si no.) */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > SHOP_TIMEZONE_MAX) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Email con forma de email (una arroba, algo antes y un dominio con punto). */
function looksLikeEmail(v: string): boolean {
  if (v.length > SHOP_EMAIL_MAX) return false;
  const at = v.indexOf("@");
  if (at <= 0 || at !== v.lastIndexOf("@")) return false;
  const domain = v.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".") && !/\s/.test(v);
}

/** Teléfono: dígitos, +, espacios, paréntesis y guiones; al menos 8 dígitos. */
function cleanPhone(raw: unknown): string | null {
  const v = cleanText(raw, SHOP_PHONE_MAX);
  if (!v) return null;
  if (!/^[0-9+()\-\s]+$/.test(v)) throw new BarberAdminError("El teléfono solo lleva números.");
  const digits = v.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new BarberAdminError("El teléfono necesita entre 8 y 15 dígitos (con lada).");
  }
  return v;
}

/**
 * Edita los datos del negocio. Solo se tocan los campos que vienen
 * (undefined = intacto). El nombre es el que sale en la página pública, en
 * los recordatorios de WhatsApp y en el ticket, así que no puede quedar vacío.
 */
export async function updateBarberProfile(
  ctx: BarberContext,
  input: ProfileInput,
): Promise<BarberShopProfile> {
  assertBarberPermission(ctx, "settings.edit");

  const data: Prisma.BarbershopUpdateInput = {};
  if (input.name !== undefined) {
    const name = cleanText(input.name, SHOP_NAME_MAX);
    if (!name) throw new BarberAdminError("El nombre de la barbería no puede quedar vacío.");
    data.name = name;
  }
  if (input.phone !== undefined) data.phone = cleanPhone(input.phone);
  if (input.email !== undefined) {
    const email = cleanText(input.email, SHOP_EMAIL_MAX).toLowerCase();
    if (email && !looksLikeEmail(email)) throw new BarberAdminError("Ese correo no tiene forma de correo.");
    data.email = email || null;
  }
  if (input.address !== undefined) data.address = cleanText(input.address, BARBER_BRANCH_ADDRESS_MAX) || null;
  if (input.city !== undefined) data.city = cleanText(input.city, SHOP_CITY_MAX) || null;
  if (input.state !== undefined) data.state = cleanText(input.state, SHOP_CITY_MAX) || null;
  if (input.timezone !== undefined) {
    const tz = cleanText(input.timezone, SHOP_TIMEZONE_MAX);
    if (!isValidTimezone(tz)) throw new BarberAdminError("Esa zona horaria no existe.");
    data.timezone = tz;
  }

  if (Object.keys(data).length > 0) {
    const r = await prisma.barbershop.updateMany({ where: { id: ctx.barbershopId }, data });
    if (r.count === 0) throw new BarberAdminError("No encontramos tu barbería.", 404);
  }
  const { slug: _slug, ...profile } = await readProfile(ctx);
  void _slug;
  return profile;
}

/** Logo: URL https (la que devolvió la subida) o null para quitarlo. */
export async function setBarberLogo(ctx: BarberContext, url: string | null): Promise<string | null> {
  assertBarberPermission(ctx, "settings.edit");
  if (url !== null) {
    if (typeof url !== "string" || url.length > 600 || !/^https:\/\//.test(url)) {
      throw new BarberAdminError("La liga del logo no es válida.");
    }
  }
  const r = await prisma.barbershop.updateMany({
    where: { id: ctx.barbershopId },
    data: { logoUrl: url },
  });
  if (r.count === 0) throw new BarberAdminError("No encontramos tu barbería.", 404);
  return url;
}

// ── Slug (dirección de la página pública) ───────────────────────────────

export type SlugProblem = "empty" | "short" | "long" | "invalid" | "reserved" | "taken";

export interface SlugCheck {
  /** Lo que se guardaría (ya normalizado). */
  slug: string;
  /** true = libre y válido. */
  available: boolean;
  /** true = es el que ya tiene la barbería (no hay nada que cambiar). */
  current: boolean;
  problem: SlugProblem | null;
}

/** Normaliza como makeBarberSlug pero sin inventar "barberia" cuando queda vacío. */
export function normalizeSlugInput(raw: unknown): string {
  const text = cleanText(raw, 200);
  if (!text) return "";
  const slug = makeBarberSlug(text);
  return slug === "barberia" && !/barber/i.test(text) ? "" : slug;
}

export function validateSlugShape(slug: string): SlugProblem | null {
  if (!slug) return "empty";
  if (slug.length < SLUG_MIN) return "short";
  if (slug.length > SLUG_MAX) return "long";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return "invalid";
  if (RESERVED_SLUGS.includes(slug)) return "reserved";
  return null;
}

/** ¿Está libre? Excluye a la propia barbería (que ya lo tiene). */
export async function checkSlugAvailability(ctx: BarberContext, raw: unknown): Promise<SlugCheck> {
  assertBarberPermission(ctx, "settings.edit");
  const slug = normalizeSlugInput(raw);
  const shape = validateSlugShape(slug);
  if (shape) return { slug, available: false, current: false, problem: shape };

  const owner = await prisma.barbershop.findUnique({ where: { slug }, select: { id: true } });
  if (owner && owner.id === ctx.barbershopId) {
    return { slug, available: false, current: true, problem: null };
  }
  if (owner) return { slug, available: false, current: false, problem: "taken" };
  return { slug, available: true, current: false, problem: null };
}

export interface SlugChange {
  previous: string;
  slug: string;
  changed: boolean;
}

/**
 * Cambia la dirección pública. ROMPE las ligas ya compartidas y los QR
 * impresos: la pantalla lo avisa con todas sus letras y pide confirmación
 * explícita (`confirm: true`) antes de llegar aquí. Aquí se vuelve a exigir
 * porque un botón no es un candado.
 *
 * La unicidad la garantiza el índice único de Barbershop.slug: si dos
 * barberías piden el mismo slug a la vez, una recibe P2002 → 409.
 */
export async function changeBarberSlug(
  ctx: BarberContext,
  raw: unknown,
  confirm: unknown,
): Promise<SlugChange> {
  assertBarberPermission(ctx, "settings.edit");
  if (confirm !== true) {
    throw new BarberAdminError(
      "Confirma que entiendes que la dirección anterior dejará de funcionar.",
    );
  }
  const check = await checkSlugAvailability(ctx, raw);
  const previous = (await readProfile(ctx)).slug;
  if (check.current) return { previous, slug: previous, changed: false };
  if (!check.available) throw new BarberAdminError(slugProblemMessage(check.problem), check.problem === "taken" ? 409 : 400);

  try {
    const r = await prisma.barbershop.updateMany({
      where: { id: ctx.barbershopId },
      data: { slug: check.slug },
    });
    if (r.count === 0) throw new BarberAdminError("No encontramos tu barbería.", 404);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new BarberAdminError(slugProblemMessage("taken"), 409);
    }
    throw e;
  }
  return { previous, slug: check.slug, changed: true };
}

export function slugProblemMessage(problem: SlugProblem | null): string {
  switch (problem) {
    case "empty":
      return "Escribe una dirección.";
    case "short":
      return `La dirección necesita al menos ${SLUG_MIN} caracteres.`;
    case "long":
      return `La dirección admite hasta ${SLUG_MAX} caracteres.`;
    case "invalid":
      return "Solo letras minúsculas, números y guiones.";
    case "reserved":
      return "Esa dirección está reservada.";
    case "taken":
      return "Esa dirección ya la usa otra barbería.";
    default:
      return "La dirección no es válida.";
  }
}

// ── Fidelidad, inactividad y campañas (delegan en clients.ts / campaigns.ts) ─

function intInRange(raw: unknown, min: number, max: number, label: string): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new BarberAdminError(`${label} tiene que ser un número entero.`);
  }
  if (n < min || n > max) throw new BarberAdminError(`${label} va de ${min} a ${max}.`);
  return n;
}

export interface LoyaltyInput {
  enabled?: unknown;
  threshold?: unknown;
  reward?: unknown;
}

export async function saveLoyaltySettings(
  ctx: BarberContext,
  input: LoyaltyInput,
): Promise<SaveSettingResult<BarberSettingsView["loyalty"]>> {
  assertBarberPermission(ctx, "settings.edit");
  const patch: Parameters<typeof saveBarberClientsConfig>[1] = {};
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new BarberAdminError("Fidelidad: encendida o apagada.");
    patch.loyaltyEnabled = input.enabled;
  }
  if (input.threshold !== undefined) {
    patch.loyaltyThreshold = intInRange(
      input.threshold,
      LOYALTY_THRESHOLD_MIN,
      LOYALTY_THRESHOLD_MAX,
      "Las visitas para ganar el premio",
    );
  }
  if (input.reward !== undefined) {
    const reward = cleanText(input.reward, LOYALTY_REWARD_MAX);
    if (!reward) throw new BarberAdminError("Ponle nombre al premio (ej. Corte gratis).");
    patch.loyaltyReward = reward;
  }
  const r = await saveBarberClientsConfig(ctx, patch);
  const view = {
    enabled: r.config.loyaltyEnabled,
    threshold: r.config.loyaltyThreshold,
    reward: r.config.loyaltyReward,
    persisted: r.config.persisted,
    min: LOYALTY_THRESHOLD_MIN,
    max: LOYALTY_THRESHOLD_MAX,
    rewardMax: LOYALTY_REWARD_MAX,
  };
  return r.ok ? { ok: true, value: view } : { ok: false, reason: r.reason ?? "error", value: view };
}

export async function saveInactivitySettings(
  ctx: BarberContext,
  input: { days?: unknown },
): Promise<SaveSettingResult<BarberSettingsView["inactivity"]>> {
  assertBarberPermission(ctx, "settings.edit");
  const days = intInRange(input.days, INACTIVE_DAYS_MIN, INACTIVE_DAYS_MAX, "Los días sin visita");
  const r = await saveBarberClientsConfig(ctx, { inactiveDays: days });
  const view = {
    days: r.config.inactiveDays,
    persisted: r.config.persisted,
    min: INACTIVE_DAYS_MIN,
    max: INACTIVE_DAYS_MAX,
  };
  return r.ok ? { ok: true, value: view } : { ok: false, reason: r.reason ?? "error", value: view };
}

export async function saveCampaignSettings(
  ctx: BarberContext,
  input: { cooldownDays?: unknown },
): Promise<SaveSettingResult<BarberSettingsView["campaigns"]>> {
  assertBarberPermission(ctx, "settings.edit");
  const cooldownDays = intInRange(
    input.cooldownDays,
    CAMPAIGN_COOLDOWN_MIN,
    CAMPAIGN_COOLDOWN_MAX,
    "Los días de descanso entre campañas",
  );
  const r = await saveBarberCampaignConfig(ctx, { cooldownDays });
  const view = {
    cooldownDays: r.config.cooldownDays,
    persisted: r.config.persisted,
    min: CAMPAIGN_COOLDOWN_MIN,
    max: CAMPAIGN_COOLDOWN_MAX,
  };
  return r.ok ? { ok: true, value: view } : { ok: false, reason: r.reason ?? "error", value: view };
}
