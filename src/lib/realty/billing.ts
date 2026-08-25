import "server-only";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRealtyPlan, getRealtyPlans, clearRealtyPlanConfigCache } from "@/lib/realty/plans";
import {
  REALTY_PLAN_IDS,
  isRealtyPlanId,
  isRealtySubscriptionActive,
  realtyPlanRank,
  type RealtyPlanId,
  type RealtyResolvedPlan,
} from "@/lib/realty/plan-shared";
import {
  realtyUsageStates,
  resolveRealtyMessageQuota,
  type RealtyUsageCounts,
} from "@/lib/realty/gating";
import type { RealtyContext } from "@/lib/realty-auth";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl INMUEBLES — motor de la SUSCRIPCIÓN a DaleControl.
 * Espejo de src/lib/barber/billing.ts, con las diferencias del vertical.
 *
 * 🔴 ESTO NO ES FACTURACIÓN DEL NEGOCIO. Aquí se cobra la mensualidad que la
 * inmobiliaria le paga a DaleControl. Los cobros de RENTA al inquilino son
 * otra cosa (RealtyRentCharge / RealtyPayment) y no pasan por aquí.
 *
 * ── LLAVES (la lección que costó cara en barber) ────────────────────────
 *   REALTY_STRIPE_SECRET_KEY || STRIPE_SECRET_KEY   ← SÍ cascadea
 *   REALTY_STRIPE_WEBHOOK_SECRET                    ← NO cascadea, jamás
 * La llave cascadea porque el aislamiento nunca dependió del NOMBRE de la
 * variable: es la misma cuenta de Stripe y lo que separa los verticales son
 * las marcas `dc_vertical` en metadata. Exigir una variable nueva bloqueó el
 * cobro de barber durante días (la del dental es Sensitive y ya no se puede
 * leer para copiarla). El SECRETO del webhook no cascadea porque Stripe firma
 * cada endpoint con su propio whsec_: el del dental nunca validaría una firma
 * dirigida a /api/realty/stripe/webhook — caer a él convertiría un 503 honesto
 * ("sin configurar") en un 400 engañoso en cada evento.
 *
 * ── PRECIOS ─────────────────────────────────────────────────────────────
 * La ÚNICA fuente es `realty_plan_configs` (getRealtyPlans). En Stripe no se
 * crea nada a mano: el producto y el precio nacen SOLOS en el primer checkout,
 * resueltos por `lookup_key`, que lleva el importe dentro
 * (`dcrealty_<plan>_<ciclo>_<centavos>`). Si Rafael edita el precio en la tabla, la
 * lookup key cambia, nace un precio nuevo y el viejo se queda con las
 * suscripciones que ya lo pagaban (comportamiento SaaS estándar). Cambiar un
 * precio toca UNA FILA, no un deploy — y no deja productos huérfanos.
 *
 * ── SIN TABLAS NUEVAS ───────────────────────────────────────────────────
 * `RealtyAccount` no guarda fechas de periodo ni facturas. La próxima fecha
 * de cobro y el historial de pagos se LEEN de Stripe al pintar la pantalla.
 * Solo se persisten 4 columnas: subscriptionStatus, stripeSubscriptionId,
 * stripeCustomerId y plan.
 *
 * ── LA CUENTA ES EL PAGADOR ─────────────────────────────────────────────
 * A diferencia de barber (matriz + sucursales en la MISMA tabla), aquí las
 * oficinas son otro modelo (RealtyOffice). Así que no hay propagación a
 * hijas: se escribe la fila de `realty_accounts` y ya.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Marcas de aislamiento entre verticales ──────────────────────────────
export const REALTY_STRIPE_VERTICAL = "realty";
/** metadata.dc_kind de las sesiones de Checkout de ESTA suscripción. */
export const REALTY_STRIPE_KIND = "realty-subscription";
/** Familias de evento que procesa el webhook de inmuebles. */
export const REALTY_WEBHOOK_EVENT_PREFIXES = [
  "checkout.session.",
  "customer.subscription.",
] as const;
/** "Viva" para Stripe ≠ "con acceso" (eso lo dice isRealtySubscriptionActive). */
export const REALTY_LIVE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
] as const;
/** Misma versión pineada que el resto del repo (la verificada en LIVE). */
export const REALTY_STRIPE_API_VERSION = "2024-06-20";
export const REALTY_CURRENCY = "mxn";

/** Estado que escribe una suspensión MANUAL de soporte (no viene de Stripe). */
export const REALTY_MANUAL_SUSPENDED_STATUS = "suspended";
export const REALTY_MANUAL_REACTIVATED_STATUS = "active";

export type RealtyBillingInterval = "month" | "year";

export function isRealtyLiveSubscriptionStatus(status: string | null | undefined): boolean {
  return !!status && (REALTY_LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

// ── Error tipado ────────────────────────────────────────────────────────

export class RealtyBillingError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown> | null;

  constructor(code: string, status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "RealtyBillingError";
    this.code = code;
    this.status = status;
    this.extra = extra ?? null;
  }
}

// ── Cliente Stripe PROPIO del vertical ──────────────────────────────────

let _stripe: Stripe | null = null;

function resolveRealtyStripeKey(): string | null {
  const key = process.env.REALTY_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  return key ? key : null;
}

export function isRealtyStripeConfigured(): boolean {
  return resolveRealtyStripeKey() !== null;
}

/** null si no hay llave (ni propia ni compartida). La app NUNCA truena por Stripe. */
export function getRealtyStripe(): Stripe | null {
  const key = resolveRealtyStripeKey();
  if (!key) return null;
  if (!_stripe) {
    _stripe = new Stripe(key, {
      apiVersion: REALTY_STRIPE_API_VERSION as never,
      timeout: 15000,
      maxNetworkRetries: 2,
    });
  }
  return _stripe;
}

export function realtyStripeUnavailable() {
  return {
    error:
      "El cobro en línea todavía no está configurado. Escríbenos a soporte y lo activamos.",
    code: "STRIPE_NOT_CONFIGURED",
  };
}

/** Base pública para success/cancel/return URLs. `||` y no `??`: una env VACÍA no debe ganar. */
export function resolveRealtyBaseUrl(requestUrl: string): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    new URL(requestUrl).origin
  );
}

// ── Dinero: pesos (tabla) ↔ centavos (Stripe) ───────────────────────────
// La regla del repo: BD y UI en PESOS; centavos SOLO en la frontera con
// Stripe, siempre con el sufijo `Cents` en el nombre.

export function toRealtyCents(
  amount: number | string | Prisma.Decimal | null | undefined,
): number {
  if (amount === null || amount === undefined) return 0;
  return new Prisma.Decimal(amount)
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** Importe del plan en centavos; null si el plan no ofrece ese ciclo. */
export function realtyPlanAmountCents(
  plan: Pick<RealtyResolvedPlan, "priceMonthly" | "priceYearly">,
  interval: RealtyBillingInterval,
): number | null {
  if (interval === "year") {
    return plan.priceYearly === null || plan.priceYearly === undefined
      ? null
      : toRealtyCents(plan.priceYearly);
  }
  return toRealtyCents(plan.priceMonthly);
}

// ── Producto y precio en Stripe, autoprovisionados ──────────────────────

/** El importe va DENTRO de la clave: editar el precio crea uno nuevo, no muta el viejo. */
export function realtyPriceLookupKey(
  planId: RealtyPlanId,
  interval: RealtyBillingInterval,
  cents: number,
): string {
  return `dcrealty_${planId}_${interval}_${cents}`;
}

type PriceLike = {
  id: string;
  active?: boolean;
  currency?: string;
  unit_amount?: number | null;
  recurring?: { interval?: string | null } | null;
  metadata?: Record<string, string> | null;
  product?: string | { metadata?: Record<string, string> | null; deleted?: boolean } | null;
};

/**
 * ¿Este precio de Stripe sirve para cobrar ESTE plan HOY? Exige: activo, MXN,
 * unit_amount == tabla, intervalo correcto y la marca dc_vertical="realty".
 * Sin la marca se rechaza aunque el importe coincida: jamás se reutiliza un
 * precio del dental ni de barber.
 */
export function isRealtyPriceUsable(
  price: PriceLike | null | undefined,
  expect: { cents: number; interval: RealtyBillingInterval },
): boolean {
  if (!price || price.active === false) return false;
  if ((price.currency ?? "").toLowerCase() !== REALTY_CURRENCY) return false;
  if (price.unit_amount !== expect.cents) return false;
  if (price.recurring?.interval !== expect.interval) return false;
  const productMeta =
    price.product && typeof price.product === "object" ? price.product.metadata ?? null : null;
  const marked =
    price.metadata?.dc_vertical === REALTY_STRIPE_VERTICAL ||
    productMeta?.dc_vertical === REALTY_STRIPE_VERTICAL;
  return marked;
}

function realtyProductName(plan: Pick<RealtyResolvedPlan, "name">): string {
  return `DaleControl Inmuebles — ${plan.name}`;
}

/** Producto del plan (uno por plan). Se busca por metadata y se crea si falta. */
export async function ensureRealtyStripeProduct(
  stripe: Stripe,
  plan: Pick<RealtyResolvedPlan, "id" | "name">,
): Promise<string> {
  try {
    const found = await stripe.products.search({
      query: `active:'true' AND metadata['dc_vertical']:'${REALTY_STRIPE_VERTICAL}' AND metadata['dc_plan']:'${plan.id}'`,
      limit: 1,
    });
    if (found.data[0]) return found.data[0].id;
  } catch (err) {
    // products.search va contra un índice con RETRASO de minutos: es
    // best-effort. Si falla, la clave de idempotencia de abajo evita el
    // duplicado durante 24 h.
    console.warn(
      "[realty billing] products.search falló; se crea idempotente:",
      (err as Error)?.message,
    );
  }
  const product = await stripe.products.create(
    {
      name: realtyProductName(plan),
      metadata: { dc_vertical: REALTY_STRIPE_VERTICAL, dc_plan: plan.id },
    },
    { idempotencyKey: `dcrealty-product-${plan.id}-v1` },
  );
  return product.id;
}

/**
 * Deja en la tabla la lookup key vigente del plan. La columna es un ESPEJO
 * de lo que se está usando hoy (útil en el admin), no un id de precio.
 *
 * ⚠️ `realty_plan_configs` tiene UNA sola columna para DOS ciclos, así que el
 * espejo es el del ciclo MENSUAL. Si se guardara también el anual, cada
 * contratación sobrescribiría a la otra y la columna mostraría la mitad del
 * tiempo una clave que no se está usando.
 */
async function persistRealtyLookupKey(planId: RealtyPlanId, lookupKey: string): Promise<void> {
  try {
    await prisma.realtyPlanConfig.update({
      where: { planId },
      data: { stripeLookupKey: lookupKey },
    });
  } catch (err) {
    // Fila ausente (tabla sin sembrar) → se sigue con el precio ya creado; la
    // próxima vez se vuelve a resolver por lookup_key, sin duplicar nada.
    console.warn(
      "[realty billing] no se pudo guardar la lookup key:",
      (err as Error)?.message,
    );
  }
  clearRealtyPlanConfigCache();
}

/**
 * Precio VIGENTE del plan para el ciclo dado. Orden:
 *   1. la lookup key guardada en la tabla, si el precio que devuelve sigue
 *      coincidiendo con la tabla (permite que Rafael apunte a mano a un
 *      precio ya existente);
 *   2. la lookup key DERIVADA del importe actual;
 *   3. crear el precio (idempotente por lookup_key) y guardar la clave.
 *
 * Se usa `prices.list({ lookup_keys })` y NO `prices.search`: list es
 * consistente al instante; search va contra un índice retrasado.
 */
export async function ensureRealtyStripePrice(
  stripe: Stripe,
  plan: RealtyResolvedPlan,
  interval: RealtyBillingInterval,
): Promise<string> {
  const cents = realtyPlanAmountCents(plan, interval);
  if (cents === null) {
    throw new RealtyBillingError(
      "INTERVAL_UNAVAILABLE",
      400,
      interval === "year"
        ? `El plan ${plan.name} no tiene precio anual configurado.`
        : `El plan ${plan.name} no tiene precio configurado.`,
    );
  }
  if (cents <= 0) {
    throw new RealtyBillingError(
      "PLAN_WITHOUT_PRICE",
      409,
      `El plan ${plan.name} no tiene un precio cobrable.`,
    );
  }
  const expect = { cents, interval };
  const lookupKey = realtyPriceLookupKey(plan.id, interval, cents);

  // 1. La clave guardada (puede ser una puesta a mano desde el admin). Solo
  //    aplica al ciclo mensual: la columna es su espejo (ver persist…).
  const stored = interval === "month" ? plan.stripeLookupKey : null;
  if (stored && stored !== lookupKey) {
    try {
      const list = await stripe.prices.list({
        lookup_keys: [stored],
        active: true,
        limit: 1,
        expand: ["data.product"],
      });
      const hit = list.data[0];
      if (hit && isRealtyPriceUsable(hit as unknown as PriceLike, expect)) return hit.id;
      console.warn(
        `[realty billing] la lookup key "${stored}" de ${plan.id}/${interval} ya no coincide con la tabla; se reemplaza`,
      );
    } catch (err) {
      console.warn(
        "[realty billing] lookup key guardada no consultable:",
        (err as Error)?.message,
      );
    }
  }

  // 2. La clave derivada del importe de HOY.
  try {
    const existing = await stripe.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
      expand: ["data.product"],
    });
    const candidate = existing.data[0];
    if (candidate && isRealtyPriceUsable(candidate as unknown as PriceLike, expect)) {
      if (interval === "month" && plan.stripeLookupKey !== lookupKey) {
        await persistRealtyLookupKey(plan.id, lookupKey);
      }
      return candidate.id;
    }
  } catch (err) {
    console.warn("[realty billing] prices.list falló:", (err as Error)?.message);
  }

  // 3. Crear. `transfer_lookup_key` evita el resource_already_exists si un
  //    precio viejo todavía tuviera esa clave.
  const productId = await ensureRealtyStripeProduct(stripe, plan);
  const created = await stripe.prices.create(
    {
      product: productId,
      currency: REALTY_CURRENCY,
      unit_amount: cents,
      recurring: { interval },
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      nickname: `${plan.name} · ${interval === "year" ? "anual" : "mensual"}`,
      metadata: {
        dc_vertical: REALTY_STRIPE_VERTICAL,
        dc_plan: plan.id,
        dc_interval: interval,
      },
    },
    { idempotencyKey: `${lookupKey}-v1` },
  );
  if (interval === "month") await persistRealtyLookupKey(plan.id, lookupKey);
  return created.id;
}

// ── La cuenta que paga ──────────────────────────────────────────────────

export const REALTY_BILLING_ACCOUNT_SELECT = {
  id: true,
  name: true,
  email: true,
  locale: true,
  plan: true,
  subscriptionStatus: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  isActive: true,
} as const;

export interface RealtyBillingAccount {
  id: string;
  name: string;
  email: string | null;
  locale: string;
  plan: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  isActive: boolean;
}

/**
 * La cuenta ES el pagador (no hay matriz/sucursal como en barber). El
 * accountId sale SIEMPRE del contexto de sesión, nunca del request.
 */
export async function getRealtyBillingAccount(
  ctx: Pick<RealtyContext, "accountId">,
): Promise<RealtyBillingAccount> {
  const account = await prisma.realtyAccount.findUnique({
    where: { id: ctx.accountId },
    select: REALTY_BILLING_ACCOUNT_SELECT,
  });
  if (!account) {
    throw new RealtyBillingError("ACCOUNT_NOT_FOUND", 404, "Cuenta no encontrada.");
  }
  return account;
}

/**
 * Correo válido o `undefined`.
 *
 * Un correo con basura hace que `customers.create` responda 400, y como la
 * llamada lleva clave de idempotencia Stripe CACHEA ese error 24 h: la cuenta
 * no podría contratar en todo un día aunque corrigiera el correo al minuto.
 * Más vale crear el customer sin correo (Stripe lo pide en el checkout) que
 * bloquear la contratación.
 */
function safeEmail(value: string | null | undefined): string | undefined {
  const email = (value ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

/** Customer de Stripe de la cuenta (creado y persistido si falta). */
export async function ensureRealtyStripeCustomer(
  stripe: Stripe,
  account: RealtyBillingAccount,
  fallbackEmail?: string | null,
): Promise<string> {
  if (account.stripeCustomerId) return account.stripeCustomerId;
  const customer = await stripe.customers.create(
    {
      email: safeEmail(account.email) ?? safeEmail(fallbackEmail),
      name: account.name,
      metadata: { dc_vertical: REALTY_STRIPE_VERTICAL, accountId: account.id },
    },
    // Con clave: dos clics simultáneos en "Contratar" NO crean dos customers
    // (en barber sí podían, y el segundo update pisaba al primero).
    { idempotencyKey: `dcrealty-customer-${account.id}-v1` },
  );
  await prisma.realtyAccount.update({
    where: { id: account.id },
    data: { stripeCustomerId: customer.id },
  });
  account.stripeCustomerId = customer.id;
  return customer.id;
}

// ── Lectura de la suscripción viva ──────────────────────────────────────

export interface SubscriptionLike {
  id: string;
  status: string;
  customer?: string | { id: string } | null;
  cancel_at_period_end?: boolean;
  current_period_end?: number | null;
  trial_end?: number | null;
  metadata?: Record<string, string> | null;
  items?: {
    data?: Array<{
      id: string;
      quantity?: number | null;
      current_period_end?: number | null;
      price?: {
        id?: string;
        /** Campo de PRIMER NIVEL del Price en Stripe, no una entrada de metadata. */
        lookup_key?: string | null;
        unit_amount?: number | null;
        recurring?: { interval?: string | null } | null;
        metadata?: Record<string, string> | null;
        product?: string | { metadata?: Record<string, string> | null } | null;
      } | null;
    }>;
  } | null;
}

export function subscriptionCustomerId(sub: SubscriptionLike): string | null {
  const c = sub.customer;
  if (!c) return null;
  return typeof c === "string" ? c : c.id ?? null;
}

/** Ciclo real de la suscripción (default defensivo: mensual). */
export function realtySubscriptionInterval(sub: SubscriptionLike): RealtyBillingInterval {
  return sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "year" : "month";
}

/**
 * Fin del periodo en curso (epoch s). 🔴 Stripe movió `current_period_end` de
 * la suscripción al ITEM en versiones recientes: hay que leer los DOS o te
 * quedas sin fecha de renovación.
 */
export function realtySubscriptionPeriodEndSeconds(sub: SubscriptionLike): number | null {
  return sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
}

/** ¿Es una suscripción de DaleControl Inmuebles? (marca en 3 sitios posibles) */
export function isRealtySubscription(sub: SubscriptionLike): boolean {
  if (sub.metadata?.dc_vertical === REALTY_STRIPE_VERTICAL) return true;
  const price = sub.items?.data?.[0]?.price;
  if (price?.metadata?.dc_vertical === REALTY_STRIPE_VERTICAL) return true;
  const productMeta =
    price?.product && typeof price.product === "object" ? price.product.metadata : null;
  return productMeta?.dc_vertical === REALTY_STRIPE_VERTICAL;
}

/**
 * Plan que cobra la suscripción: metadata del precio → metadata de la
 * suscripción → lookup key guardada en la tabla. null = no se puede saber
 * (entonces NO se toca el plan de la cuenta).
 */
export function realtySubscriptionPlanId(
  sub: SubscriptionLike,
  plans?: ReadonlyArray<Pick<RealtyResolvedPlan, "id" | "stripeLookupKey">>,
): RealtyPlanId | null {
  const price = sub.items?.data?.[0]?.price;
  const fromPrice = price?.metadata?.dc_plan;
  if (isRealtyPlanId(fromPrice)) return fromPrice;
  const fromSub = sub.metadata?.dc_plan;
  if (isRealtyPlanId(fromSub)) return fromSub;
  // Último recurso: la lookup key guardada en la tabla. Se lee de
  // `price.lookup_key`, que es un campo de PRIMER NIVEL del Price —
  // `price.metadata.lookup_key` no existe y esta red de seguridad nunca
  // habría atrapado nada (p. ej. una suscripción creada a mano en el
  // dashboard de Stripe con el precio correcto pero sin dc_plan).
  const lookup = price?.lookup_key;
  if (lookup) {
    if (plans) {
      for (const p of plans) {
        if (p.stripeLookupKey && p.stripeLookupKey === lookup) return p.id;
      }
    }
    // Y si la tabla aún no la tiene guardada, la propia clave lleva el plan
    // dentro: dcrealty_<PLAN>_<ciclo>_<centavos>. Se exige el prefijo nuestro
    // para no leer por accidente la clave de un precio ajeno.
    if (lookup.startsWith("dcrealty_")) {
      const parte = lookup.split("_")[1];
      if (isRealtyPlanId(parte)) return parte;
    }
  }
  return null;
}

const SUB_EXPAND = { expand: ["items.data.price"] };

async function loadLiveRealtySubscription(
  stripe: Stripe,
  account: RealtyBillingAccount,
): Promise<Stripe.Subscription> {
  if (!account.stripeSubscriptionId) {
    throw new RealtyBillingError(
      "NO_SUBSCRIPTION",
      409,
      "Todavía no tienes una suscripción activa. Contrata un plan primero.",
    );
  }
  try {
    return await stripe.subscriptions.retrieve(account.stripeSubscriptionId, SUB_EXPAND);
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    if (code === "resource_missing") {
      throw new RealtyBillingError(
        "SUBSCRIPTION_MISSING",
        409,
        "Tu suscripción ya no existe en Stripe. Vuelve a contratar el plan que quieras.",
      );
    }
    throw new RealtyBillingError(
      "STRIPE_ERROR",
      502,
      err?.message ?? "Stripe no respondió.",
    );
  }
}

// ── Escritura del estado (idempotente por construcción) ─────────────────

export interface RealtyAccountRef {
  id: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Hace falta para no pisar una suspensión MANUAL de soporte. */
  subscriptionStatus: string;
}

const ACCOUNT_REF_SELECT = {
  id: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  subscriptionStatus: true,
} as const;

/** Subconjunto de Prisma que usa el webhook; inyectable para probarlo sin BD. */
export interface RealtyBillingDb {
  realtyAccount: {
    findFirst(args: unknown): Promise<RealtyAccountRef | null>;
    update(args: unknown): Promise<unknown>;
  };
}

export function prismaRealtyBillingDb(): RealtyBillingDb {
  return prisma as unknown as RealtyBillingDb;
}

/**
 * Cuenta dueña de la suscripción: metadata.accountId (que escribimos en el
 * checkout) VERIFICADA contra el customer; si no cuadra, por customer.
 */
export async function resolveRealtyAccountForSubscription(
  db: RealtyBillingDb,
  sub: SubscriptionLike,
): Promise<RealtyAccountRef | null> {
  const customerId = subscriptionCustomerId(sub);
  const metaId = sub.metadata?.accountId;
  if (metaId) {
    const byMeta = await db.realtyAccount.findFirst({
      where: { id: metaId },
      select: ACCOUNT_REF_SELECT,
    });
    if (byMeta && (!byMeta.stripeCustomerId || byMeta.stripeCustomerId === customerId)) {
      return byMeta;
    }
  }
  if (!customerId) return null;
  return db.realtyAccount.findFirst({
    where: { stripeCustomerId: customerId },
    select: ACCOUNT_REF_SELECT,
  });
}

export interface RealtySubscriptionPatch {
  /** Estado de Stripe TAL CUAL (active | past_due | canceled | trialing | …). */
  subscriptionStatus: string;
  stripeSubscriptionId: string;
  plan?: RealtyPlanId;
}

export function realtySubscriptionPatch(
  sub: SubscriptionLike,
  plans?: ReadonlyArray<Pick<RealtyResolvedPlan, "id" | "stripeLookupKey">>,
): RealtySubscriptionPatch {
  const plan = realtySubscriptionPlanId(sub, plans);
  return {
    subscriptionStatus: sub.status,
    stripeSubscriptionId: sub.id,
    ...(plan ? { plan } : {}),
  };
}

export interface ApplyRealtySubscriptionResult {
  applied: boolean;
  reason: string;
  accountId?: string;
  patch?: RealtySubscriptionPatch;
}

/**
 * Escribe el estado ABSOLUTO de la suscripción en `realty_accounts`.
 * Idempotente: mismo input → mismas escrituras, cero inserts. Un evento
 * repetido o fuera de orden converge al mismo estado; el eco de una
 * suscripción vieja y muerta no puede pisar a la que hoy paga.
 */
export async function applyRealtySubscription(
  db: RealtyBillingDb,
  sub: SubscriptionLike,
  opts?: { plans?: ReadonlyArray<Pick<RealtyResolvedPlan, "id" | "stripeLookupKey">> },
): Promise<ApplyRealtySubscriptionResult> {
  if (!isRealtySubscription(sub)) return { applied: false, reason: "not-realty" };
  const account = await resolveRealtyAccountForSubscription(db, sub);
  if (!account) return { applied: false, reason: "account-not-found" };

  if (
    account.stripeSubscriptionId &&
    account.stripeSubscriptionId !== sub.id &&
    !isRealtyLiveSubscriptionStatus(sub.status)
  ) {
    return { applied: false, reason: "stale-subscription", accountId: account.id };
  }

  const patch = realtySubscriptionPatch(sub, opts?.plans);
  const customerId = subscriptionCustomerId(sub);

  // 🔴 UNA SUSPENSIÓN MANUAL GANA SOBRE STRIPE. `suspended` lo escribe un
  // humano de soporte y Stripe nunca lo produce. Si se sobrescribiera con el
  // estado de la suscripción, la próxima renovación (un
  // customer.subscription.updated garantizado cada mes) volvería a poner
  // "active" y la suspensión se levantaría SOLA, sin que nadie se entere.
  // Los ids y el plan sí se siguen sincronizando: cuando soporte reactive,
  // la fila ya está al día.
  const manualHold = account.subscriptionStatus === REALTY_MANUAL_SUSPENDED_STATUS;

  await db.realtyAccount.update({
    where: { id: account.id },
    data: {
      ...(manualHold ? {} : { subscriptionStatus: patch.subscriptionStatus }),
      stripeSubscriptionId: patch.stripeSubscriptionId,
      ...(patch.plan ? { plan: patch.plan } : {}),
      ...(!account.stripeCustomerId && customerId ? { stripeCustomerId: customerId } : {}),
    },
  });
  return {
    applied: true,
    reason: manualHold ? "manual-hold" : "ok",
    accountId: account.id,
    patch,
  };
}

// ── Webhook ─────────────────────────────────────────────────────────────

export function isRealtyWebhookEventType(type: string): boolean {
  return REALTY_WEBHOOK_EVENT_PREFIXES.some((p) => type.startsWith(p));
}

export interface RealtyStripeReader {
  subscriptions: {
    retrieve(id: string, params?: Record<string, unknown>): Promise<unknown>;
  };
}

export interface RealtyWebhookOutcome {
  handled: boolean;
  action: string;
  accountId?: string;
}

async function retrieveLiveSubscription(
  stripe: RealtyStripeReader,
  id: string,
  fallback: SubscriptionLike | null,
): Promise<SubscriptionLike | null> {
  try {
    return (await stripe.subscriptions.retrieve(id, SUB_EXPAND)) as SubscriptionLike;
  } catch (err) {
    console.warn(
      "[realty webhook] no se pudo releer la suscripción; se usa el payload:",
      (err as Error)?.message,
    );
    return fallback;
  }
}

/**
 * Procesa UN evento YA VERIFICADO. Nunca cobra: relee la suscripción viva y
 * escribe su estado absoluto. Los eventos ajenos (dental, barber) salen con
 * handled=false. Solo lanza ante fallos transitorios, para que Stripe
 * reintente.
 */
export async function handleRealtyStripeEvent(
  stripe: RealtyStripeReader,
  db: RealtyBillingDb,
  event: { id: string; type: string; data: { object: unknown } },
  opts?: { plans?: ReadonlyArray<Pick<RealtyResolvedPlan, "id" | "stripeLookupKey">> },
): Promise<RealtyWebhookOutcome> {
  if (!isRealtyWebhookEventType(event.type)) return { handled: false, action: "ignored-type" };

  if (event.type.startsWith("checkout.session.")) {
    const session = event.data.object as {
      id: string;
      metadata?: Record<string, string> | null;
      subscription?: string | { id: string } | null;
    };
    if (session.metadata?.dc_kind !== REALTY_STRIPE_KIND) {
      return { handled: false, action: "not-realty" };
    }
    if (
      event.type !== "checkout.session.completed" &&
      event.type !== "checkout.session.async_payment_succeeded"
    ) {
      // expired / async_payment_failed: no hay nada que activar. La cuenta
      // sigue en pending_payment y puede reintentar desde la pantalla.
      return { handled: true, action: "noop" };
    }
    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id ?? null;
    if (!subId) return { handled: true, action: "no-subscription" };
    const sub = await retrieveLiveSubscription(stripe, subId, null);
    if (!sub) throw new Error(`Suscripción ${subId} no recuperable`);
    const result = await applyRealtySubscription(db, sub, { plans: opts?.plans });
    return {
      handled: result.applied,
      action: `checkout:${result.reason}`,
      accountId: result.accountId,
    };
  }

  const payload = event.data.object as SubscriptionLike;
  if (!isRealtySubscription(payload)) return { handled: false, action: "not-realty" };
  const live = (await retrieveLiveSubscription(stripe, payload.id, payload)) ?? payload;
  const result = await applyRealtySubscription(db, live, { plans: opts?.plans });
  return {
    handled: result.applied,
    action: `subscription:${result.reason}`,
    accountId: result.accountId,
  };
}

// ── Checkout ────────────────────────────────────────────────────────────

export function isFirstRealtyContract(
  account: Pick<RealtyBillingAccount, "stripeSubscriptionId">,
): boolean {
  return !account.stripeSubscriptionId;
}

export async function createRealtyCheckoutSession(args: {
  stripe: Stripe;
  account: RealtyBillingAccount;
  plan: RealtyResolvedPlan;
  interval: RealtyBillingInterval;
  baseUrl: string;
  fallbackEmail?: string | null;
}): Promise<{ url: string; sessionId: string }> {
  const { stripe, account, plan, interval, baseUrl } = args;
  if (!plan.isActive) {
    throw new RealtyBillingError(
      "PLAN_INACTIVE",
      400,
      `El plan ${plan.name} ya no está disponible.`,
    );
  }

  // Ya hay una suscripción VIVA → jamás una segunda (doble cobro recurrente).
  if (account.stripeSubscriptionId) {
    let existing: (SubscriptionLike & { latest_invoice?: unknown }) | null = null;
    try {
      existing = (await stripe.subscriptions.retrieve(account.stripeSubscriptionId, {
        expand: ["latest_invoice"],
      })) as unknown as SubscriptionLike & { latest_invoice?: unknown };
    } catch (err: any) {
      const code = err?.code ?? err?.raw?.code;
      // 🔴 SOLO `resource_missing` significa "ya no existe". Ante un timeout,
      // un 429 o un 500 de Stripe NO se puede asumir que no hay suscripción:
      // asumirlo crea una SEGUNDA y la cuenta paga dos veces cada mes, con la
      // primera huérfana (la pantalla solo mira stripeSubscriptionId, así que
      // nadie la vuelve a ver). Ante la duda no se cobra.
      if (code !== "resource_missing") {
        throw new RealtyBillingError(
          "STRIPE_UNREACHABLE",
          503,
          "No pudimos comprobar el estado de tu suscripción. No se hizo ningún cargo: inténtalo de nuevo en un minuto.",
        );
      }
      existing = null;
    }
    if (existing && isRealtyLiveSubscriptionStatus(existing.status)) {
      const inv = existing.latest_invoice as {
        status?: string;
        hosted_invoice_url?: string | null;
      } | null;
      throw new RealtyBillingError(
        "ALREADY_SUBSCRIBED",
        409,
        "Ya tienes una suscripción activa. Cambia de plan desde esta pantalla o actualiza tu tarjeta.",
        {
          status: existing.status,
          openInvoiceUrl:
            inv && inv.status === "open" ? inv.hosted_invoice_url ?? null : null,
        },
      );
    }
  }

  const customerId = await ensureRealtyStripeCustomer(stripe, account, args.fallbackEmail);
  const priceId = await ensureRealtyStripePrice(stripe, plan, interval);

  const meta: Record<string, string> = {
    dc_vertical: REALTY_STRIPE_VERTICAL,
    dc_kind: REALTY_STRIPE_KIND,
    accountId: account.id,
    dc_plan: plan.id,
    dc_interval: interval,
  };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    // Sin esto Stripe truena al querer escribir los datos del formulario
    // sobre un customer que ya existe.
    customer_update: { address: "auto", name: "auto" },
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    locale: account.locale === "en" ? "en" : "es",
    metadata: meta,
    subscription_data: { metadata: meta },
    // Vuelve a la pantalla, que confirma la sesión contra Stripe sin esperar
    // al webhook: así nadie cree que el pago falló y pague dos veces.
    success_url: `${baseUrl}/inmobiliaria/suscripcion?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/inmobiliaria/suscripcion?checkout=cancel`,
  });

  if (!session.url) {
    throw new RealtyBillingError("CHECKOUT_NO_URL", 502, "Stripe no devolvió la URL de pago.");
  }
  return { url: session.url, sessionId: session.id };
}

/**
 * Al volver de Stripe: verifica que la sesión sea NUESTRA y de ESTA cuenta, y
 * aplica la suscripción por la MISMA ruta que el webhook (idempotente).
 */
export async function confirmRealtyCheckoutSession(
  stripe: Stripe,
  db: RealtyBillingDb,
  account: RealtyBillingAccount,
  sessionId: string,
): Promise<{ applied: boolean; status: string | null; paymentStatus: string | null }> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription.items.data.price"],
    });
  } catch {
    throw new RealtyBillingError("SESSION_NOT_FOUND", 404, "No encontramos esa sesión de pago.");
  }
  if (
    session.metadata?.dc_kind !== REALTY_STRIPE_KIND ||
    session.metadata?.accountId !== account.id
  ) {
    throw new RealtyBillingError(
      "SESSION_NOT_OURS",
      403,
      "Esa sesión de pago no pertenece a esta cuenta.",
    );
  }
  const sub = session.subscription as unknown as SubscriptionLike | string | null;
  if (!sub || typeof sub === "string") {
    return { applied: false, status: null, paymentStatus: session.payment_status ?? null };
  }
  const plans = await getRealtyPlans();
  const result = await applyRealtySubscription(db, sub, { plans });
  return {
    applied: result.applied,
    status: sub.status,
    paymentStatus: session.payment_status ?? null,
  };
}

// ── Cambio de plan con prorrateo ────────────────────────────────────────

export type RealtyChangeDirection = "upgrade" | "downgrade" | "same";

/**
 * Manda el IMPORTE (es lo que Stripe prorratea), con el TIER como veto: bajar
 * de plan nunca se cobra hoy aunque el precio congelado en la suscripción sea
 * menor que el del plan destino.
 */
export function resolveRealtyChangeDirection(args: {
  currentCents: number;
  targetCents: number;
  currentPlanId?: string | null;
  targetPlanId?: string | null;
}): RealtyChangeDirection {
  const byAmount: RealtyChangeDirection =
    args.targetCents > args.currentCents
      ? "upgrade"
      : args.targetCents < args.currentCents
        ? "downgrade"
        : "same";
  if (byAmount !== "upgrade") return byAmount;
  if (isRealtyPlanId(args.currentPlanId) && isRealtyPlanId(args.targetPlanId)) {
    if (realtyPlanRank(args.targetPlanId) < realtyPlanRank(args.currentPlanId)) {
      return "downgrade";
    }
  }
  return "upgrade";
}

/**
 * Parámetros del subscriptions.update.
 * INVARIANTE: SIN `billing_cycle_anchor` — la fecha de renovación NO se mueve.
 *  · UPGRADE   → always_invoice (cobra el diferencial HOY) + error_if_incomplete
 *                (si la tarjeta rechaza, el plan NO cambia).
 *  · DOWNGRADE → create_prorations (crédito a la próxima factura).
 */
export function buildRealtySubscriptionUpdateParams(args: {
  itemId: string;
  priceId: string;
  direction: RealtyChangeDirection;
  metadata: Record<string, string>;
}): {
  items: Array<{ id: string; price: string }>;
  proration_behavior: "always_invoice" | "create_prorations";
  metadata: Record<string, string>;
  payment_behavior?: "error_if_incomplete";
} {
  const isUpgrade = args.direction === "upgrade";
  return {
    items: [{ id: args.itemId, price: args.priceId }],
    proration_behavior: isUpgrade ? "always_invoice" : "create_prorations",
    metadata: args.metadata,
    ...(isUpgrade ? { payment_behavior: "error_if_incomplete" as const } : {}),
  };
}

const CHARGE_ERROR_CODES = new Set([
  "card_declined",
  "expired_card",
  "incorrect_cvc",
  "incorrect_number",
  "insufficient_funds",
  "processing_error",
  "authentication_required",
  "payment_intent_authentication_failure",
  "subscription_payment_intent_requires_action",
  "invoice_payment_intent_requires_action",
]);

/** ¿El error de Stripe es un FALLO DE COBRO (y no un request inválido nuestro)? */
export function isRealtyChargeFailure(err: unknown): boolean {
  const e = err as {
    type?: string;
    code?: string;
    raw?: { code?: string; payment_intent?: unknown };
  } | null;
  if (!e) return false;
  if (e.type === "StripeCardError") return true;
  const code = e.code ?? e.raw?.code;
  if (code && CHARGE_ERROR_CODES.has(code)) return true;
  return !!e.raw?.payment_intent;
}

export function realtyChargeFailureReason(err: unknown): string {
  const e = err as { message?: string; raw?: { message?: string } } | null;
  return e?.raw?.message ?? e?.message ?? "La tarjeta fue rechazada.";
}

export interface RealtyPlanChangeResult {
  plan: RealtyPlanId;
  status: string;
  direction: RealtyChangeDirection;
  chargedNow: boolean;
}

export async function changeRealtyPlan(args: {
  stripe: Stripe;
  db: RealtyBillingDb;
  account: RealtyBillingAccount;
  currentPlan: RealtyResolvedPlan;
  targetPlan: RealtyResolvedPlan;
  plans: RealtyResolvedPlan[];
}): Promise<RealtyPlanChangeResult> {
  const { stripe, db, account, currentPlan, targetPlan } = args;
  if (!targetPlan.isActive) {
    throw new RealtyBillingError(
      "PLAN_INACTIVE",
      400,
      `El plan ${targetPlan.name} ya no está disponible.`,
    );
  }
  const sub = await loadLiveRealtySubscription(stripe, account);
  const item = sub.items.data[0];
  if (!item) {
    throw new RealtyBillingError("NO_ITEMS", 409, "Suscripción sin conceptos en Stripe.");
  }

  const interval = realtySubscriptionInterval(sub as unknown as SubscriptionLike);
  const targetCents = realtyPlanAmountCents(targetPlan, interval);
  if (targetCents === null) {
    throw new RealtyBillingError(
      "INTERVAL_UNAVAILABLE",
      400,
      `El plan ${targetPlan.name} no tiene precio ${interval === "year" ? "anual" : "mensual"}.`,
    );
  }
  const currentCents =
    item.price?.unit_amount ?? realtyPlanAmountCents(currentPlan, interval) ?? 0;
  const direction = resolveRealtyChangeDirection({
    currentCents,
    targetCents,
    currentPlanId: account.plan,
    targetPlanId: targetPlan.id,
  });
  if (direction === "same" && targetPlan.id === account.plan) {
    throw new RealtyBillingError("SAME_PLAN", 409, "Ya estás en ese plan.");
  }
  const priceId = await ensureRealtyStripePrice(stripe, targetPlan, interval);

  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(sub.id, {
      ...buildRealtySubscriptionUpdateParams({
        itemId: item.id,
        priceId,
        direction,
        metadata: {
          ...(sub.metadata ?? {}),
          dc_vertical: REALTY_STRIPE_VERTICAL,
          dc_kind: REALTY_STRIPE_KIND,
          accountId: account.id,
          dc_plan: targetPlan.id,
          dc_interval: interval,
        },
      }),
      expand: ["items.data.price"],
    } as Stripe.SubscriptionUpdateParams);
  } catch (err: any) {
    if (isRealtyChargeFailure(err)) {
      throw new RealtyBillingError(
        "UPGRADE_PAYMENT_FAILED",
        402,
        "No se pudo cobrar la diferencia del cambio de plan. Tu plan NO cambió.",
        { reason: realtyChargeFailureReason(err) },
      );
    }
    throw new RealtyBillingError(
      "STRIPE_ERROR",
      502,
      err?.message ?? "Stripe rechazó el cambio de plan.",
    );
  }
  // Sin idempotencyKey a propósito: una clave estable haría que Stripe
  // repitiera el error CACHEADO cuando el usuario corrige su tarjeta.

  await applyRealtySubscription(db, updated as unknown as SubscriptionLike, {
    plans: args.plans,
  });
  return {
    plan: targetPlan.id,
    status: updated.status,
    direction,
    chargedNow: direction === "upgrade",
  };
}

// ── Vista previa del cambio ─────────────────────────────────────────────

export interface PreviewLineRaw {
  proration?: boolean;
  amount?: number | null;
  description?: string | null;
  period?: { start?: number | null; end?: number | null } | null;
}

/** Una factura de prorrateo SIEMPRE trae líneas proration:true. */
export function hasProrationLines(lines: PreviewLineRaw[]): boolean {
  return lines.some((l) => l.proration === true);
}

/** ¿La simulación trae además la RENOVACIÓN del próximo ciclo? (inflaría el "hoy") */
export function hasRenewalLine(
  lines: PreviewLineRaw[],
  currentPeriodEndSeconds: number | null | undefined,
): boolean {
  if (!currentPeriodEndSeconds) return false;
  const threshold = currentPeriodEndSeconds - 60;
  return lines.some((l) => !l.proration && (l.period?.start ?? 0) >= threshold);
}

/** Centavos a cobrar HOY; null = la simulación no es la del cobro inmediato. */
export function realtyPreviewAmountDueCents(
  invoice:
    | { amount_due?: number | null; lines?: { data?: PreviewLineRaw[] } | null }
    | null
    | undefined,
  currentPeriodEndSeconds?: number | null,
): number | null {
  const lines = invoice?.lines?.data ?? [];
  if (!hasProrationLines(lines)) return null;
  if (hasRenewalLine(lines, currentPeriodEndSeconds)) return null;
  return Math.max(0, invoice?.amount_due ?? 0);
}

export interface RealtyChangePreview {
  targetPlan: RealtyPlanId;
  direction: RealtyChangeDirection;
  interval: RealtyBillingInterval;
  /** Centavos a cobrar HOY. null = no se pudo simular con confianza. */
  dueTodayCents: number | null;
  currentPeriodEndAt: string | null;
  unavailable: boolean;
}

export async function previewRealtyPlanChange(args: {
  stripe: Stripe;
  account: RealtyBillingAccount;
  currentPlan: RealtyResolvedPlan;
  targetPlan: RealtyResolvedPlan;
}): Promise<RealtyChangePreview> {
  const { stripe, account, currentPlan, targetPlan } = args;
  const sub = await loadLiveRealtySubscription(stripe, account);
  const item = sub.items.data[0];
  if (!item) throw new RealtyBillingError("NO_ITEMS", 409, "Suscripción sin conceptos.");

  const interval = realtySubscriptionInterval(sub as unknown as SubscriptionLike);
  const targetCents = realtyPlanAmountCents(targetPlan, interval) ?? 0;
  const currentCents =
    item.price?.unit_amount ?? realtyPlanAmountCents(currentPlan, interval) ?? 0;
  const direction = resolveRealtyChangeDirection({
    currentCents,
    targetCents,
    currentPlanId: account.plan,
    targetPlanId: targetPlan.id,
  });
  const periodEnd = realtySubscriptionPeriodEndSeconds(sub as unknown as SubscriptionLike);
  const baseline: RealtyChangePreview = {
    targetPlan: targetPlan.id,
    direction,
    interval,
    dueTodayCents: null,
    currentPeriodEndAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    unavailable: false,
  };

  const priceId = await ensureRealtyStripePrice(stripe, targetPlan, interval);
  let invoice: any = null;
  try {
    // API nueva.
    invoice = await (stripe.invoices as any).createPreview({
      customer: account.stripeCustomerId ?? undefined,
      subscription: sub.id,
      subscription_details: {
        items: [{ id: item.id, price: priceId, quantity: item.quantity ?? 1 }],
        proration_behavior: "always_invoice",
      },
    });
  } catch (err: any) {
    try {
      // API vieja. `invoices.retrieveUpcoming` NO existe en el SDK 22.
      //
      // 🔴 Los parámetros van en el PATH, no como objeto: `rawRequest` del SDK
      // 22 lanza "rawRequest only supports params on POST requests" si se le
      // pasa un objeto con un GET — es decir, este plan B nunca llegaba a la
      // red y solo servía para escribir un console.warn.
      const qs = new URLSearchParams({
        subscription: sub.id,
        "subscription_items[0][id]": item.id,
        "subscription_items[0][price]": priceId,
        "subscription_items[0][quantity]": String(item.quantity ?? 1),
        subscription_proration_behavior: "always_invoice",
      });
      invoice = await (stripe as any).rawRequest(
        "GET",
        `/v1/invoices/upcoming?${qs.toString()}`,
        null,
      );
    } catch (err2: any) {
      console.warn(
        "[realty billing] preview no disponible:",
        err?.message,
        "/",
        err2?.message,
      );
    }
  }
  if (!invoice) return { ...baseline, unavailable: true };

  return {
    ...baseline,
    dueTodayCents:
      direction === "upgrade" ? realtyPreviewAmountDueCents(invoice, periodEnd) : 0,
  };
}

// ── Cancelar / reanudar ─────────────────────────────────────────────────

/**
 * cancel=true → `cancel_at_period_end` (el plan sigue hasta el fin del periodo
 * YA PAGADO; Stripe manda customer.subscription.deleted al terminar).
 * Nunca `subscriptions.cancel()`: eso mataría un periodo pagado.
 */
export async function setRealtySubscriptionCancel(
  stripe: Stripe,
  db: RealtyBillingDb,
  account: RealtyBillingAccount,
  cancel: boolean,
  plans: RealtyResolvedPlan[],
): Promise<{ status: string; cancelAtPeriodEnd: boolean; currentPeriodEndAt: string | null }> {
  const sub = await loadLiveRealtySubscription(stripe, account);
  const updated = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: cancel,
    expand: ["items.data.price"],
  } as Stripe.SubscriptionUpdateParams);
  await applyRealtySubscription(db, updated as unknown as SubscriptionLike, { plans });
  const periodEnd = realtySubscriptionPeriodEndSeconds(updated as unknown as SubscriptionLike);
  return {
    status: updated.status,
    cancelAtPeriodEnd: updated.cancel_at_period_end,
    currentPeriodEndAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };
}

// ── Portal de facturación (método de pago + facturas) ───────────────────

let _portalConfigId: string | null = null;

/**
 * Configuración del portal SOLO para inmuebles: actualizar tarjeta, ver
 * facturas y datos de contacto. SIN cambio de plan ni cancelación DENTRO de
 * Stripe (eso vive en /inmobiliaria/suscripcion, con prorrateo y límites
 * propios).
 *
 * 🔴 Si no se pasa una configuración propia, Stripe usa la de la cuenta —
 * que es la del DENTAL, con sus planes en el selector. Una inmobiliaria
 * vería precios de clínicas.
 */
export async function ensureRealtyPortalConfiguration(stripe: Stripe): Promise<string> {
  if (_portalConfigId) return _portalConfigId;
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const ours = existing.data.find((c) => c.metadata?.dc_vertical === REALTY_STRIPE_VERTICAL);
  if (ours) {
    _portalConfigId = ours.id;
    return ours.id;
  }
  const created = await stripe.billingPortal.configurations.create(
    {
      business_profile: { headline: "DaleControl Inmuebles" },
      features: {
        customer_update: {
          enabled: true,
          allowed_updates: ["email", "address", "phone", "name"],
        },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
      },
      metadata: { dc_vertical: REALTY_STRIPE_VERTICAL },
    },
    { idempotencyKey: "dcrealty-portal-config-v1" },
  );
  _portalConfigId = created.id;
  return created.id;
}

export async function createRealtyPortalSession(
  stripe: Stripe,
  account: RealtyBillingAccount,
  returnUrl: string,
): Promise<string> {
  if (!account.stripeCustomerId) {
    throw new RealtyBillingError(
      "NO_CUSTOMER",
      400,
      "Todavía no hay un método de pago: contrata un plan primero.",
    );
  }
  const configuration = await ensureRealtyPortalConfiguration(stripe);
  const session = await stripe.billingPortal.sessions.create({
    customer: account.stripeCustomerId,
    configuration,
    return_url: returnUrl,
  });
  return session.url;
}

// ── Consumo real de la cuenta (lo que gating.ts necesita medir) ─────────

/**
 * Consumo de una cuenta. Aquí se MIDE; en `@/lib/realty/gating.ts` se DECIDE.
 * Nunca lanza: un fallo de conteo no puede tumbar la pantalla.
 */
export async function getRealtyUsage(
  accountId: string,
  account?: { storageUsedBytes?: bigint | number | null; messagesUsedPeriod?: number | null },
): Promise<RealtyUsageCounts> {
  let base = account ?? null;
  try {
    if (!base) {
      base = await prisma.realtyAccount.findUnique({
        where: { id: accountId },
        select: { storageUsedBytes: true, messagesUsedPeriod: true },
      });
    }
    const [users, offices, properties] = await Promise.all([
      prisma.realtyUser.count({ where: { accountId, active: true } }),
      prisma.realtyOffice.count({ where: { accountId, isActive: true } }),
      prisma.realtyProperty.count({ where: { accountId } }),
    ]);
    return {
      users,
      offices,
      properties,
      storageBytes: Number(base?.storageUsedBytes ?? 0),
      messages: base?.messagesUsedPeriod ?? 0,
    };
  } catch (e) {
    console.error("[realty billing] no se pudo medir el consumo:", e);
    // `degraded` hace que los CUPOS fallen cerrados: unos ceros de mentira
    // dejarían pasar a cualquiera ("0 de 1 usuarios").
    return {
      users: 0,
      offices: 0,
      properties: 0,
      storageBytes: Number(base?.storageUsedBytes ?? 0),
      messages: base?.messagesUsedPeriod ?? 0,
      degraded: true,
    };
  }
}

// ── Resumen para la pantalla de suscripción ─────────────────────────────

export interface RealtyInvoiceRow {
  id: string;
  number: string | null;
  status: string;
  /** CENTAVOS. La UI divide entre 100 una sola vez, al pintar. */
  amountCents: number;
  currency: string;
  createdAt: string;
  hostedUrl: string | null;
  pdfUrl: string | null;
  failureReason: string | null;
}

export interface RealtySubscriptionInfo {
  id: string;
  status: string;
  interval: RealtyBillingInterval;
  cancelAtPeriodEnd: boolean;
  currentPeriodEndAt: string | null;
  trialEndsAt: string | null;
  /** Precio congelado en la suscripción, en CENTAVOS. */
  unitAmountCents: number | null;
  openInvoiceUrl: string | null;
}

export interface RealtyBillingSummary {
  stripeConfigured: boolean;
  planId: RealtyPlanId;
  subscriptionStatus: string;
  subscriptionActive: boolean;
  hasCustomer: boolean;
  subscription: RealtySubscriptionInfo | null;
  invoices: RealtyInvoiceRow[];
  /** true = Stripe no respondió; la pantalla lo dice en vez de inventar. */
  stripeUnreachable: boolean;
}

function invoiceFailureReason(inv: any): string | null {
  const pi = inv?.payment_intent;
  if (pi && typeof pi === "object") {
    const err = pi.last_payment_error;
    if (err?.message) return String(err.message);
  }
  if (inv?.status === "open" && (inv?.attempt_count ?? 0) > 0) {
    return "El cobro no pasó. Actualiza tu método de pago.";
  }
  return null;
}

export async function getRealtyBillingSummary(
  account: RealtyBillingAccount,
): Promise<RealtyBillingSummary> {
  const planId = isRealtyPlanId(account.plan) ? account.plan : "PROPIETARIO";
  const base: RealtyBillingSummary = {
    stripeConfigured: isRealtyStripeConfigured(),
    planId,
    subscriptionStatus: account.subscriptionStatus,
    subscriptionActive: isRealtySubscriptionActive(account),
    hasCustomer: !!account.stripeCustomerId,
    subscription: null,
    invoices: [],
    stripeUnreachable: false,
  };

  const stripe = getRealtyStripe();
  if (!stripe || !account.stripeCustomerId) return base;

  let subscription: RealtySubscriptionInfo | null = null;
  let invoices: RealtyInvoiceRow[] = [];
  let unreachable = false;

  if (account.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(account.stripeSubscriptionId, {
        expand: ["items.data.price", "latest_invoice"],
      });
      const like = sub as unknown as SubscriptionLike;
      const periodEnd = realtySubscriptionPeriodEndSeconds(like);
      const inv = (sub as any).latest_invoice as {
        status?: string;
        hosted_invoice_url?: string | null;
      } | null;
      subscription = {
        id: sub.id,
        status: sub.status,
        interval: realtySubscriptionInterval(like),
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        currentPeriodEndAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        unitAmountCents: like.items?.data?.[0]?.price?.unit_amount ?? null,
        openInvoiceUrl:
          inv && inv.status === "open" ? inv.hosted_invoice_url ?? null : null,
      };
    } catch (err: any) {
      const code = err?.code ?? err?.raw?.code;
      if (code !== "resource_missing") {
        unreachable = true;
        console.warn("[realty billing] no se pudo leer la suscripción:", err?.message);
      }
      // resource_missing = borrada en Stripe → se enseña "sin suscripción".
    }
  }

  try {
    // El expand del payment_intent trae el motivo del rechazo; si la versión
    // de API no lo admite, se reintenta sin él.
    let raw: any[] = [];
    try {
      const res = await stripe.invoices.list({
        customer: account.stripeCustomerId,
        limit: 12,
        expand: ["data.payment_intent"],
      } as any);
      raw = res.data;
    } catch {
      const res = await stripe.invoices.list({
        customer: account.stripeCustomerId,
        limit: 12,
      });
      raw = res.data;
    }
    invoices = raw.map((inv: any) => ({
      id: inv.id,
      number: inv.number ?? null,
      status: inv.status ?? "draft",
      amountCents: inv.amount_paid || inv.amount_due || inv.total || 0,
      currency: (inv.currency ?? REALTY_CURRENCY).toUpperCase(),
      createdAt: new Date((inv.created ?? 0) * 1000).toISOString(),
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
      failureReason: invoiceFailureReason(inv),
    }));
  } catch (err: any) {
    unreachable = true;
    console.warn("[realty billing] no se pudieron leer las facturas:", err?.message);
  }

  return { ...base, subscription, invoices, stripeUnreachable: unreachable };
}

// ── Cortesía de soporte: días regalados que EXPIRAN SOLOS ───────────────

/**
 * Regala N días a una cuenta usando el TRIAL de Stripe. Es la única forma
 * honesta sin columna nueva: Stripe lo expira solo y el webhook escribe el
 * desenlace. No hay "cortesía eterna" que nadie recuerde apagar.
 *
 *  · Con suscripción viva → se corre `trial_end` (sin prorratear).
 *  · Sin suscripción      → se crea una en trial SIN método de pago, con
 *    `missing_payment_method: "cancel"`: al vencer, Stripe la cancela y la
 *    cuenta vuelve sola a estar impaga.
 */
export async function grantRealtyTrialDays(args: {
  stripe: Stripe;
  db: RealtyBillingDb;
  account: RealtyBillingAccount;
  days: number;
  plans: RealtyResolvedPlan[];
}): Promise<{ trialEndsAt: string; status: string; created: boolean }> {
  const { stripe, db, account, plans } = args;
  const days = Math.floor(args.days);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw new RealtyBillingError("BAD_DAYS", 400, "Los días deben ir de 1 a 365.");
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const addSec = days * 24 * 60 * 60;

  if (account.stripeSubscriptionId) {
    let sub: Stripe.Subscription | null = null;
    try {
      sub = await stripe.subscriptions.retrieve(account.stripeSubscriptionId, SUB_EXPAND);
    } catch {
      sub = null;
    }
    if (sub && sub.status !== "canceled" && sub.status !== "incomplete_expired") {
      const like = sub as unknown as SubscriptionLike;
      // Se suma sobre lo que ya tenía pagado/regalado, nunca se le quita.
      const from = Math.max(
        nowSec,
        like.trial_end ?? 0,
        realtySubscriptionPeriodEndSeconds(like) ?? 0,
      );
      const trialEnd = from + addSec;
      const updated = await stripe.subscriptions.update(sub.id, {
        trial_end: trialEnd,
        proration_behavior: "none",
        expand: ["items.data.price"],
      } as Stripe.SubscriptionUpdateParams);
      await applyRealtySubscription(db, updated as unknown as SubscriptionLike, { plans });
      return {
        trialEndsAt: new Date(trialEnd * 1000).toISOString(),
        status: updated.status,
        created: false,
      };
    }
  }

  // Sin suscripción: se crea una en trial, sin tarjeta.
  const planId = isRealtyPlanId(account.plan) ? account.plan : "PROPIETARIO";
  const plan = plans.find((p) => p.id === planId) ?? (await getRealtyPlan(planId));
  const customerId = await ensureRealtyStripeCustomer(stripe, account);
  const priceId = await ensureRealtyStripePrice(stripe, plan, "month");
  const trialEnd = nowSec + addSec;
  const meta: Record<string, string> = {
    dc_vertical: REALTY_STRIPE_VERTICAL,
    dc_kind: REALTY_STRIPE_KIND,
    accountId: account.id,
    dc_plan: plan.id,
    dc_interval: "month",
    dc_courtesy: String(days),
  };
  const created = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId, quantity: 1 }],
    trial_end: trialEnd,
    // Al vencer sin tarjeta, Stripe CANCELA. Nadie queda cobrando de más ni
    // regalado para siempre.
    trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    payment_behavior: "default_incomplete",
    metadata: meta,
    expand: ["items.data.price"],
  } as Stripe.SubscriptionCreateParams);
  await applyRealtySubscription(db, created as unknown as SubscriptionLike, { plans });
  return {
    trialEndsAt: new Date(trialEnd * 1000).toISOString(),
    status: created.status,
    created: true,
  };
}

// ── Re-exports de conveniencia para las pantallas ───────────────────────
export { getRealtyPlan, getRealtyPlans, realtyUsageStates, resolveRealtyMessageQuota };
export { REALTY_PLAN_IDS };
