import "server-only";
import Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BarberContext } from "@/lib/barber-auth";
import { clearBarberPlanConfigCache, getBarberPlans } from "@/lib/barber/plans";
import {
  barberPlanRank,
  isBarberPlanId,
  type BarberPlanId,
  type BarberResolvedPlan,
} from "@/lib/barber/plan-shared";

/**
 * DaleControl BARBER — cobro de la suscripción de la BARBERÍA a DaleControl.
 *
 * Frontera: aquí se cobra a la barbería por usar el producto. Las membresías
 * y anticipos del cliente final son de src/lib/barber/payments.ts (T4) y NO
 * pasan por aquí. Dos webhooks, dos secretos, tipos de evento disjuntos:
 *   · ESTE módulo escucha  checkout.session.*  y  customer.subscription.*
 *   · T4 escucha            payment_intent.*   y los de sus membresías
 * y además todo objeto nuestro lleva metadata.dc_vertical = "barber" y las
 * sesiones metadata.dc_kind = "barber-subscription": aunque el mismo evento
 * llegue a otro endpoint, nadie procesa lo ajeno.
 *
 * AISLAMIENTO DEL DENTAL (Stripe LIVE, sin entorno de prueba):
 *   · Cliente Stripe PROPIO: nunca se importa src/lib/stripe.ts. La LLAVE
 *     cae en cascada, con la misma regla que payments.ts:
 *       BARBER_STRIPE_SECRET_KEY || STRIPE_SECRET_KEY
 *     Hoy es la misma cuenta de Stripe que el dental, así que compartir la
 *     llave no mezcla nada: el aislamiento lo dan la marca dc_vertical, el
 *     lookup_key propio y el portal propio (abajo), no el nombre de la
 *     variable. La propia gana si existe, por si el vertical algún día vive
 *     en su propia cuenta.
 *   · El SECRETO del webhook (BARBER_STRIPE_WEBHOOK_SECRET) NO cae a nada:
 *     Stripe firma cada endpoint con un whsec_ distinto y el del dental
 *     jamás validaría una firma dirigida a /api/barber/stripe/webhook.
 *   · Productos y precios PROPIOS, etiquetados metadata.dc_vertical="barber"
 *     y con lookup_key "dcbarber_<plan>_<intervalo>_<centavos>". Un precio
 *     guardado en la tabla que NO tenga esa marca se descarta y se crea el
 *     nuestro: jamás se reutiliza un precio del dental.
 *   · Portal de facturación con configuración PROPIA (sin cambio de plan ni
 *     cancelación dentro de Stripe): un cliente barber nunca ve los planes
 *     dentales desde el portal.
 *
 * PRECIOS: la ÚNICA fuente es barber_plan_configs (getBarberPlans). Los ids
 * de precio de Stripe (stripePriceIdMonthly/Yearly) son una CACHÉ que se
 * auto-cura: si Rafael edita priceMonthly en la fila, el precio guardado deja
 * de coincidir (unit_amount ≠ tabla) y el siguiente checkout/cambio de plan
 * crea un precio nuevo y lo persiste. Un cambio de precio toca una fila, no
 * un deploy. Las suscripciones existentes conservan su precio hasta que
 * cambien de plan (comportamiento SaaS estándar).
 *
 * DINERO: la tabla guarda Decimal; a Stripe van CENTAVOS enteros calculados
 * con Prisma.Decimal (toCents). Nunca se multiplica un float.
 *
 * IDEMPOTENCIA DEL WEBHOOK (sin tabla de eventos — el contrato no crea
 * tablas): los handlers NO cobran nada y no insertan filas. Cada evento de
 * suscripción se resuelve RELEYENDO la suscripción viva en Stripe y
 * escribiendo su estado ABSOLUTO sobre Barbershop (matriz + sucursales).
 * Un evento repetido o fuera de orden converge al mismo estado; una
 * suscripción vieja que ya no es la vigente se ignora (stale-subscription).
 */

// ── Constantes del contrato ──────────────────────────────────────────────

export const BARBER_STRIPE_VERTICAL = "barber";
/** metadata.dc_kind de las sesiones de Checkout de ESTA suscripción. */
export const BARBER_STRIPE_KIND = "barber-subscription";
/** Familias de evento que procesa el webhook de barber (disjuntas de T4). */
export const BARBER_WEBHOOK_EVENT_PREFIXES = ["checkout.session.", "customer.subscription."] as const;
export const BARBER_LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid"] as const;
/** Misma versión pineada que el resto del repo (lo verificado en LIVE). */
export const BARBER_STRIPE_API_VERSION = "2024-06-20";
export const BARBER_CURRENCY = "mxn";

export type BarberBillingInterval = "month" | "year";
export type BarberChangeDirection = "upgrade" | "downgrade" | "same";

export function isBarberBillingInterval(v: unknown): v is BarberBillingInterval {
  return v === "month" || v === "year";
}

/** Error de negocio del cobro; las rutas lo mapean con barberBillingErrorPayload. */
export class BarberBillingError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(code: string, status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = "BarberBillingError";
    this.code = code;
    this.status = status;
    this.extra = extra ?? {};
  }
}

export function barberBillingErrorPayload(
  err: unknown,
): { status: number; body: Record<string, unknown> } | null {
  if (err instanceof BarberBillingError) {
    return { status: err.status, body: { error: err.message, code: err.code, ...err.extra } };
  }
  return null;
}

// ── Cliente Stripe PROPIO del vertical ───────────────────────────────────

let _stripe: Stripe | null = null;

/**
 * Llave del cliente propio, en cascada (misma regla que payments.ts):
 *   BARBER_STRIPE_SECRET_KEY || STRIPE_SECRET_KEY
 * Así activar el cobro no exige duplicar en Vercel una variable Sensitive
 * cuyo valor ya nadie puede leer. No se exporta: la llave no sale de aquí.
 * El secreto del webhook NO cascadea (ver /api/barber/stripe/webhook).
 */
function resolveBarberStripeKey(): string | null {
  const key = process.env.BARBER_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  return key ? key : null;
}

export function isBarberStripeConfigured(): boolean {
  return resolveBarberStripeKey() !== null;
}

/** null si no hay llave, ni propia ni compartida (la app nunca crashea por Stripe). */
export function getBarberStripe(): Stripe | null {
  const key = resolveBarberStripeKey();
  if (!key) return null;
  if (!_stripe) {
    _stripe = new Stripe(key, {
      apiVersion: BARBER_STRIPE_API_VERSION as never,
      timeout: 15000,
      maxNetworkRetries: 2,
    });
  }
  return _stripe;
}

export function barberStripeUnavailable() {
  return {
    error: "El cobro en línea aún no está configurado. Escríbenos a soporte para activar tu plan.",
    code: "STRIPE_NOT_CONFIGURED",
  };
}

// ── Dinero: Decimal → centavos enteros ───────────────────────────────────

export function toCents(amount: number | string | Prisma.Decimal | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  return new Prisma.Decimal(amount)
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}

/** Importe del plan en centavos para el intervalo; null si el plan no ofrece ese ciclo. */
export function planAmountCents(
  plan: Pick<BarberResolvedPlan, "priceMonthly" | "priceYearly">,
  interval: BarberBillingInterval,
): number | null {
  if (interval === "year") {
    return plan.priceYearly === null || plan.priceYearly === undefined ? null : toCents(plan.priceYearly);
  }
  return toCents(plan.priceMonthly);
}

/** Descuento del primer mes (centavos) si firstMonthPrice < priceMonthly; 0 si no aplica. */
export function planFirstMonthDiscountCents(
  plan: Pick<BarberResolvedPlan, "priceMonthly" | "firstMonthPrice">,
): number {
  if (plan.firstMonthPrice === null || plan.firstMonthPrice === undefined) return 0;
  const diff = toCents(plan.priceMonthly) - toCents(plan.firstMonthPrice);
  return diff > 0 ? diff : 0;
}

// ── La fila que paga (matriz) ────────────────────────────────────────────

export interface BarberBillingShop {
  id: string;
  name: string;
  email: string | null;
  locale: string;
  plan: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export const BARBER_BILLING_SHOP_SELECT = {
  id: true,
  name: true,
  email: true,
  locale: true,
  plan: true,
  subscriptionStatus: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
} as const;

/**
 * Barbería que PAGA: la matriz de la familia. barbershopId sale del contexto
 * de sesión, nunca del request. Una sucursal opera la suscripción de su matriz.
 */
export async function getBarberBillingShop(ctx: BarberContext): Promise<BarberBillingShop> {
  const rootId = ctx.barbershop.parentId ?? ctx.barbershopId;
  const shop = await prisma.barbershop.findUnique({
    where: { id: rootId },
    select: BARBER_BILLING_SHOP_SELECT,
  });
  if (!shop) throw new BarberBillingError("SHOP_NOT_FOUND", 404, "Barbería no encontrada.");
  return shop;
}

// ── Catálogo en Stripe (productos, precios, cupón) ───────────────────────

export function barberPriceLookupKey(
  planId: BarberPlanId,
  interval: BarberBillingInterval,
  cents: number,
): string {
  return `dcbarber_${planId}_${interval}_${cents}`;
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
 * ¿Un precio de Stripe sirve para cobrar ESTE plan en ESTE ciclo hoy?
 * Exige: activo, MXN, unit_amount == tabla, intervalo correcto y la marca
 * dc_vertical="barber" (en el precio o en su producto). Sin la marca se
 * rechaza aunque coincida el importe: nunca se reutiliza un precio ajeno.
 */
export function isBarberPriceUsable(
  price: PriceLike | null | undefined,
  expect: { cents: number; interval: BarberBillingInterval },
): boolean {
  if (!price || price.active === false) return false;
  if ((price.currency ?? "").toLowerCase() !== BARBER_CURRENCY) return false;
  if (price.unit_amount !== expect.cents) return false;
  if (price.recurring?.interval !== expect.interval) return false;
  const productMeta =
    price.product && typeof price.product === "object" ? price.product.metadata ?? null : null;
  const marked =
    price.metadata?.dc_vertical === BARBER_STRIPE_VERTICAL ||
    productMeta?.dc_vertical === BARBER_STRIPE_VERTICAL;
  return marked;
}

function planProductName(plan: Pick<BarberResolvedPlan, "name">): string {
  return `DaleControl Barber — ${plan.name}`;
}

/** Producto de Stripe del plan (uno por plan, buscado por metadata; creado si falta). */
export async function ensureBarberStripeProduct(
  stripe: Stripe,
  plan: Pick<BarberResolvedPlan, "id" | "name">,
): Promise<string> {
  try {
    const found = await stripe.products.search({
      query: `active:'true' AND metadata['dc_vertical']:'${BARBER_STRIPE_VERTICAL}' AND metadata['dc_plan']:'${plan.id}'`,
      limit: 1,
    });
    if (found.data[0]) return found.data[0].id;
  } catch (err) {
    // El search es best-effort (índice con retraso): si falla, la clave de
    // idempotencia de abajo evita duplicar el producto dentro de 24h.
    console.warn("[barber billing] products.search falló; se crea/idempotente:", (err as Error)?.message);
  }
  const product = await stripe.products.create(
    {
      name: planProductName(plan),
      metadata: { dc_vertical: BARBER_STRIPE_VERTICAL, dc_plan: plan.id },
    },
    { idempotencyKey: `dcbarber-product-${plan.id}-v1` },
  );
  return product.id;
}

async function persistPlanPriceId(
  planId: BarberPlanId,
  interval: BarberBillingInterval,
  priceId: string,
): Promise<void> {
  try {
    await prisma.barberPlanConfig.update({
      where: { planId },
      data: interval === "year" ? { stripePriceIdYearly: priceId } : { stripePriceIdMonthly: priceId },
    });
  } catch (err) {
    // Fila ausente (tabla sin sembrar) → se sigue con el precio ya creado;
    // la próxima vez se vuelve a resolver por lookup_key, no se duplica.
    console.warn("[barber billing] no se pudo persistir el price id:", (err as Error)?.message);
  }
  clearBarberPlanConfigCache();
}

/**
 * Precio de Stripe VIGENTE del plan para el ciclo dado. Orden:
 *  1. el id guardado en la tabla, si sigue coincidiendo con ella;
 *  2. un precio nuestro ya creado con el mismo lookup_key (tabla recién
 *     sembrada o id borrado);
 *  3. crear uno (idempotente por lookup_key) y persistirlo en la tabla.
 */
export async function ensureBarberStripePrice(
  stripe: Stripe,
  plan: BarberResolvedPlan,
  interval: BarberBillingInterval,
): Promise<string> {
  const cents = planAmountCents(plan, interval);
  if (cents === null) {
    throw new BarberBillingError(
      "INTERVAL_UNAVAILABLE",
      400,
      interval === "year"
        ? `El plan ${plan.name} no tiene precio anual configurado.`
        : `El plan ${plan.name} no tiene precio configurado.`,
    );
  }
  if (cents <= 0) {
    throw new BarberBillingError("PLAN_WITHOUT_PRICE", 409, `El plan ${plan.name} no tiene un precio cobrable.`);
  }
  const expect = { cents, interval };

  const stored = interval === "year" ? plan.stripePriceIdYearly : plan.stripePriceIdMonthly;
  if (stored) {
    try {
      const price = await stripe.prices.retrieve(stored, { expand: ["product"] });
      if (isBarberPriceUsable(price as unknown as PriceLike, expect)) return price.id;
      console.warn(
        `[barber billing] price ${stored} de ${plan.id}/${interval} ya no coincide con la tabla; se reemplaza`,
      );
    } catch (err) {
      console.warn("[barber billing] price guardado no recuperable:", (err as Error)?.message);
    }
  }

  const lookupKey = barberPriceLookupKey(plan.id, interval, cents);
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const candidate = existing.data[0];
  if (candidate && isBarberPriceUsable(candidate as unknown as PriceLike, expect)) {
    await persistPlanPriceId(plan.id, interval, candidate.id);
    return candidate.id;
  }

  const productId = await ensureBarberStripeProduct(stripe, plan);
  const created = await stripe.prices.create(
    {
      product: productId,
      currency: BARBER_CURRENCY,
      unit_amount: cents,
      recurring: { interval },
      lookup_key: lookupKey,
      transfer_lookup_key: true,
      nickname: `${plan.name} · ${interval === "year" ? "anual" : "mensual"}`,
      metadata: { dc_vertical: BARBER_STRIPE_VERTICAL, dc_plan: plan.id, dc_interval: interval },
    },
    { idempotencyKey: `${lookupKey}-v1` },
  );
  await persistPlanPriceId(plan.id, interval, created.id);
  return created.id;
}

/**
 * Cupón "once" que deja la PRIMERA factura mensual en firstMonthPrice. El id
 * embebe el descuento: si la tabla cambia, nace otro cupón (son inmutables).
 * null si el plan no configura primer mes o el descuento no es > 0.
 */
export async function ensureBarberFirstMonthCoupon(
  stripe: Stripe,
  plan: BarberResolvedPlan,
): Promise<string | null> {
  const off = planFirstMonthDiscountCents(plan);
  if (off <= 0) return null;
  const id = `dcbarber-first-month-${plan.id.toLowerCase()}-${off}`;
  try {
    await stripe.coupons.retrieve(id);
    return id;
  } catch (err: any) {
    if (err?.statusCode !== 404 && err?.code !== "resource_missing") throw err;
  }
  try {
    await stripe.coupons.create({
      id,
      amount_off: off,
      currency: BARBER_CURRENCY,
      duration: "once",
      name: `DaleControl Barber · primer mes ${plan.name}`,
      metadata: { dc_vertical: BARBER_STRIPE_VERTICAL, dc_plan: plan.id },
    });
  } catch (err: any) {
    if (err?.code !== "resource_already_exists") throw err;
  }
  return id;
}

/** Customer de Stripe de la matriz (creado y persistido si falta). */
export async function ensureBarberStripeCustomer(
  stripe: Stripe,
  shop: BarberBillingShop,
  fallbackEmail?: string | null,
): Promise<string> {
  if (shop.stripeCustomerId) return shop.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: shop.email ?? fallbackEmail ?? undefined,
    name: shop.name,
    metadata: { dc_vertical: BARBER_STRIPE_VERTICAL, barbershopId: shop.id },
  });
  await prisma.barbershop.update({
    where: { id: shop.id },
    data: { stripeCustomerId: customer.id },
  });
  shop.stripeCustomerId = customer.id;
  return customer.id;
}

// ── Lecturas puras de una suscripción de Stripe ──────────────────────────

type SubscriptionLike = {
  id: string;
  status: string;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  canceled_at?: number | null;
  current_period_end?: number | null;
  items?: {
    data?: Array<{
      id?: string;
      current_period_end?: number | null;
      price?: {
        id?: string;
        unit_amount?: number | null;
        recurring?: { interval?: string | null } | null;
        metadata?: Record<string, string> | null;
        product?: string | { metadata?: Record<string, string> | null } | null;
      } | null;
    }>;
  } | null;
};

export function subscriptionCustomerId(sub: SubscriptionLike): string | null {
  if (!sub.customer) return null;
  return typeof sub.customer === "string" ? sub.customer : sub.customer.id ?? null;
}

/** Ciclo real de la suscripción (default defensivo: mensual). */
export function subscriptionInterval(sub: SubscriptionLike): BarberBillingInterval {
  return sub.items?.data?.[0]?.price?.recurring?.interval === "year" ? "year" : "month";
}

/** Fin del periodo en curso (epoch s): en el item (API nueva) o en la suscripción (API pineada). */
export function subscriptionPeriodEndSeconds(sub: SubscriptionLike): number | null {
  return sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
}

/** ¿Es una suscripción de DaleControl Barber? (marca nuestra en metadata / precio). */
export function isBarberSubscription(sub: SubscriptionLike): boolean {
  if (sub.metadata?.dc_vertical === BARBER_STRIPE_VERTICAL) return true;
  const price = sub.items?.data?.[0]?.price;
  if (price?.metadata?.dc_vertical === BARBER_STRIPE_VERTICAL) return true;
  const productMeta = price?.product && typeof price.product === "object" ? price.product.metadata : null;
  return productMeta?.dc_vertical === BARBER_STRIPE_VERTICAL;
}

export function isLiveBarberSubscriptionStatus(status: string | null | undefined): boolean {
  return !!status && (BARBER_LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Plan que cobra la suscripción: metadata del precio (lo escribimos al
 * crearlo) → metadata de la suscripción → id de precio guardado en la tabla.
 * null = no se puede saber (no se toca el plan de la barbería).
 */
export function subscriptionPlanId(
  sub: SubscriptionLike,
  plans?: ReadonlyArray<Pick<BarberResolvedPlan, "id" | "stripePriceIdMonthly" | "stripePriceIdYearly">>,
): BarberPlanId | null {
  const price = sub.items?.data?.[0]?.price;
  const fromPrice = price?.metadata?.dc_plan;
  if (isBarberPlanId(fromPrice)) return fromPrice;
  const fromSub = sub.metadata?.dc_plan;
  if (isBarberPlanId(fromSub)) return fromSub;
  if (price?.id && plans) {
    const hit = plans.find((p) => p.stripePriceIdMonthly === price.id || p.stripePriceIdYearly === price.id);
    if (hit) return hit.id;
  }
  return null;
}

export interface BarberSubscriptionPatch {
  /** Estado de Stripe tal cual (active | trialing | past_due | unpaid | canceled | incomplete | …). */
  subscriptionStatus: string;
  stripeSubscriptionId: string;
  plan?: BarberPlanId;
}

/** Estado ABSOLUTO a escribir en Barbershop a partir de la suscripción viva. Determinista. */
export function subscriptionPatchFromStripe(
  sub: SubscriptionLike,
  plans?: ReadonlyArray<Pick<BarberResolvedPlan, "id" | "stripePriceIdMonthly" | "stripePriceIdYearly">>,
): BarberSubscriptionPatch {
  const plan = subscriptionPlanId(sub, plans);
  return {
    subscriptionStatus: sub.status,
    stripeSubscriptionId: sub.id,
    ...(plan ? { plan } : {}),
  };
}

// ── Aplicar la suscripción a la barbería (matriz + sucursales) ───────────

export interface BarberShopRef {
  id: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

/** Subconjunto de Prisma que usa el webhook; inyectable para probarlo sin BD. */
export interface BarberBillingDb {
  barbershop: {
    findFirst(args: unknown): Promise<BarberShopRef | null>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
  };
}

export function prismaBillingDb(): BarberBillingDb {
  return prisma as unknown as BarberBillingDb;
}

const SHOP_REF_SELECT = { id: true, stripeCustomerId: true, stripeSubscriptionId: true } as const;

/**
 * Matriz dueña de la suscripción: metadata.barbershopId (que escribimos en
 * el checkout) verificada contra el customer; si no cuadra, por customer.
 */
export async function resolveBarbershopForSubscription(
  db: BarberBillingDb,
  sub: SubscriptionLike,
): Promise<BarberShopRef | null> {
  const customerId = subscriptionCustomerId(sub);
  const metaId = sub.metadata?.barbershopId;
  if (metaId) {
    const byMeta = await db.barbershop.findFirst({
      where: { id: metaId, parentId: null },
      select: SHOP_REF_SELECT,
    });
    if (byMeta && (!byMeta.stripeCustomerId || byMeta.stripeCustomerId === customerId)) return byMeta;
  }
  if (!customerId) return null;
  return db.barbershop.findFirst({
    where: { stripeCustomerId: customerId, parentId: null },
    select: SHOP_REF_SELECT,
  });
}

export interface ApplyBarberSubscriptionResult {
  applied: boolean;
  reason: "ok" | "not-barber" | "shop-not-found" | "stale-subscription";
  shopId?: string;
  patch?: BarberSubscriptionPatch;
}

/**
 * Escribe el estado de la suscripción en la matriz y lo PROPAGA a las
 * sucursales (plan + subscriptionStatus; los ids de Stripe viven solo en la
 * matriz). Idempotente: mismo input → mismas escrituras, cero inserts.
 */
export async function applyBarberSubscription(
  db: BarberBillingDb,
  sub: SubscriptionLike,
  opts?: { plans?: ReadonlyArray<Pick<BarberResolvedPlan, "id" | "stripePriceIdMonthly" | "stripePriceIdYearly">> },
): Promise<ApplyBarberSubscriptionResult> {
  if (!isBarberSubscription(sub)) return { applied: false, reason: "not-barber" };
  const shop = await resolveBarbershopForSubscription(db, sub);
  if (!shop) return { applied: false, reason: "shop-not-found" };

  // Otra suscripción distinta de la vigente: solo se adopta si está VIVA
  // (nueva contratación tras cancelar). Un eco de una suscripción vieja y
  // cancelada no puede pisar a la que hoy paga.
  if (
    shop.stripeSubscriptionId &&
    shop.stripeSubscriptionId !== sub.id &&
    !isLiveBarberSubscriptionStatus(sub.status)
  ) {
    return { applied: false, reason: "stale-subscription", shopId: shop.id };
  }

  const patch = subscriptionPatchFromStripe(sub, opts?.plans);
  const customerId = subscriptionCustomerId(sub);
  await db.barbershop.update({
    where: { id: shop.id },
    data: {
      subscriptionStatus: patch.subscriptionStatus,
      stripeSubscriptionId: patch.stripeSubscriptionId,
      ...(patch.plan ? { plan: patch.plan } : {}),
      ...(!shop.stripeCustomerId && customerId ? { stripeCustomerId: customerId } : {}),
    },
  });
  await db.barbershop.updateMany({
    where: { parentId: shop.id },
    data: {
      subscriptionStatus: patch.subscriptionStatus,
      ...(patch.plan ? { plan: patch.plan } : {}),
    },
  });
  return { applied: true, reason: "ok", shopId: shop.id, patch };
}

// ── Webhook: despacho de eventos (solo checkout.session.* y customer.subscription.*) ──

/** Lo mínimo de Stripe que usa el despachador (inyectable en pruebas). */
export interface BarberStripeReader {
  subscriptions: {
    retrieve(id: string, params?: Record<string, unknown>): Promise<unknown>;
  };
}

export interface BarberWebhookOutcome {
  handled: boolean;
  action: string;
  shopId?: string;
}

export function isBarberWebhookEventType(type: string): boolean {
  return BARBER_WEBHOOK_EVENT_PREFIXES.some((p) => type.startsWith(p));
}

const SUB_EXPAND = { expand: ["items.data.price"] };

async function retrieveLiveSubscription(
  stripe: BarberStripeReader,
  id: string,
  fallback: SubscriptionLike | null,
): Promise<SubscriptionLike | null> {
  try {
    return (await stripe.subscriptions.retrieve(id, SUB_EXPAND)) as SubscriptionLike;
  } catch (err) {
    console.warn("[barber webhook] no se pudo releer la suscripción; se usa el payload:", (err as Error)?.message);
    return fallback;
  }
}

/**
 * Procesa UN evento ya verificado. Nunca cobra; solo lee Stripe y escribe el
 * estado absoluto. Los eventos ajenos (dental, T4, otros kinds) se ignoran
 * con handled=false. Lanza solo ante fallos transitorios (BD/red) para que
 * Stripe reintente.
 */
export async function handleBarberStripeEvent(
  stripe: BarberStripeReader,
  db: BarberBillingDb,
  event: { id: string; type: string; data: { object: unknown } },
  opts?: { plans?: ReadonlyArray<Pick<BarberResolvedPlan, "id" | "stripePriceIdMonthly" | "stripePriceIdYearly">> },
): Promise<BarberWebhookOutcome> {
  if (!isBarberWebhookEventType(event.type)) return { handled: false, action: "ignored-type" };

  if (event.type.startsWith("checkout.session.")) {
    const session = event.data.object as {
      id: string;
      mode?: string;
      metadata?: Record<string, string> | null;
      subscription?: string | { id: string } | null;
    };
    if (session.metadata?.dc_kind !== BARBER_STRIPE_KIND) return { handled: false, action: "not-barber" };
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
      // expired / async_payment_failed: nada que activar; la barbería sigue
      // en pending_payment y puede reintentar desde /barber/suscripcion.
      return { handled: true, action: "noop" };
    }
    const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
    if (!subId) return { handled: true, action: "no-subscription" };
    const sub = await retrieveLiveSubscription(stripe, subId, null);
    if (!sub) throw new Error(`Suscripción ${subId} no recuperable`);
    const result = await applyBarberSubscription(db, sub, { plans: opts?.plans });
    return { handled: result.applied, action: `checkout:${result.reason}`, shopId: result.shopId };
  }

  // customer.subscription.created | updated | deleted | paused | resumed | …
  const payload = event.data.object as SubscriptionLike;
  if (!isBarberSubscription(payload)) return { handled: false, action: "not-barber" };
  const live = (await retrieveLiveSubscription(stripe, payload.id, payload)) ?? payload;
  const result = await applyBarberSubscription(db, live, { plans: opts?.plans });
  return { handled: result.applied, action: `subscription:${result.reason}`, shopId: result.shopId };
}

// ── Checkout ─────────────────────────────────────────────────────────────

/** Primera contratación = nunca tuvo suscripción (el id no se limpia al cancelar). */
export function isFirstBarberContract(shop: Pick<BarberBillingShop, "stripeSubscriptionId">): boolean {
  return !shop.stripeSubscriptionId;
}

export async function createBarberCheckoutSession(args: {
  stripe: Stripe;
  shop: BarberBillingShop;
  plan: BarberResolvedPlan;
  interval: BarberBillingInterval;
  baseUrl: string;
  fallbackEmail?: string | null;
}): Promise<{ url: string; sessionId: string }> {
  const { stripe, shop, plan, interval, baseUrl } = args;
  if (!plan.isActive) {
    throw new BarberBillingError("PLAN_INACTIVE", 400, `El plan ${plan.name} ya no está disponible.`);
  }

  // Ya hay una suscripción VIVA → jamás una segunda (doble cobro recurrente).
  if (shop.stripeSubscriptionId) {
    let existing: (SubscriptionLike & { latest_invoice?: unknown }) | null = null;
    try {
      existing = (await stripe.subscriptions.retrieve(shop.stripeSubscriptionId, {
        expand: ["latest_invoice"],
      })) as unknown as SubscriptionLike & { latest_invoice?: unknown };
    } catch {
      existing = null; // ya no existe en Stripe → contratación normal
    }
    if (existing && isLiveBarberSubscriptionStatus(existing.status)) {
      const inv = existing.latest_invoice as { status?: string; hosted_invoice_url?: string | null } | null;
      throw new BarberBillingError(
        "ALREADY_SUBSCRIBED",
        409,
        "Ya tienes una suscripción activa. Cambia de plan desde esta pantalla o actualiza tu tarjeta.",
        {
          status: existing.status,
          openInvoiceUrl: inv && inv.status === "open" ? inv.hosted_invoice_url ?? null : null,
        },
      );
    }
  }

  const customerId = await ensureBarberStripeCustomer(stripe, shop, args.fallbackEmail);
  const priceId = await ensureBarberStripePrice(stripe, plan, interval);
  const coupon =
    interval === "month" && isFirstBarberContract(shop)
      ? await ensureBarberFirstMonthCoupon(stripe, plan)
      : null;

  const meta: Record<string, string> = {
    dc_vertical: BARBER_STRIPE_VERTICAL,
    dc_kind: BARBER_STRIPE_KIND,
    barbershopId: shop.id,
    dc_plan: plan.id,
    dc_interval: interval,
    firstMonthCoupon: coupon ?? "",
  };

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    customer_update: { address: "auto", name: "auto" },
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    locale: shop.locale === "en" ? "en" : "es",
    metadata: meta,
    subscription_data: { metadata: meta },
    ...(coupon ? { discounts: [{ coupon }] } : {}),
    // Vuelve a /barber/suscripcion, que confirma la sesión contra Stripe
    // (confirmBarberCheckoutSession) sin esperar al webhook: así nadie cree
    // que el pago falló y paga dos veces.
    success_url: `${baseUrl}/barber/suscripcion?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/barber/suscripcion?checkout=cancel`,
  });

  if (!session.url) throw new BarberBillingError("CHECKOUT_NO_URL", 502, "Stripe no devolvió la URL de pago.");
  return { url: session.url, sessionId: session.id };
}

/**
 * Al volver de Stripe: verifica que la sesión sea NUESTRA y de ESTA barbería
 * y aplica la suscripción (misma ruta que el webhook → idempotente). Cierra
 * el hueco entre el pago y la llegada del webhook.
 */
export async function confirmBarberCheckoutSession(
  stripe: Stripe,
  db: BarberBillingDb,
  shop: BarberBillingShop,
  sessionId: string,
): Promise<{ applied: boolean; status: string | null; paymentStatus: string | null }> {
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription.items.data.price"] });
  } catch {
    throw new BarberBillingError("SESSION_NOT_FOUND", 404, "No encontramos esa sesión de pago.");
  }
  if (session.metadata?.dc_kind !== BARBER_STRIPE_KIND || session.metadata?.barbershopId !== shop.id) {
    throw new BarberBillingError("SESSION_NOT_OURS", 403, "Esa sesión de pago no pertenece a esta barbería.");
  }
  const sub = session.subscription as unknown as SubscriptionLike | string | null;
  if (!sub || typeof sub === "string") {
    return { applied: false, status: null, paymentStatus: session.payment_status ?? null };
  }
  const plans = await getBarberPlans();
  const result = await applyBarberSubscription(db, sub, { plans });
  return { applied: result.applied, status: sub.status, paymentStatus: session.payment_status ?? null };
}

// ── Cambio de plan con prorrateo (espejo del enfoque del dental) ─────────

/**
 * Dirección del cambio: manda el importe (es lo que Stripe prorratea), con el
 * TIER como veto — bajar de plan nunca se cobra hoy aunque el precio
 * congelado en la suscripción sea menor que el del plan destino.
 */
export function resolveBarberChangeDirection(args: {
  currentCents: number;
  targetCents: number;
  currentPlanId?: string | null;
  targetPlanId?: string | null;
}): BarberChangeDirection {
  const byAmount: BarberChangeDirection =
    args.targetCents > args.currentCents ? "upgrade" : args.targetCents < args.currentCents ? "downgrade" : "same";
  if (byAmount !== "upgrade") return byAmount;
  if (isBarberPlanId(args.currentPlanId) && isBarberPlanId(args.targetPlanId)) {
    if (barberPlanRank(args.targetPlanId) < barberPlanRank(args.currentPlanId)) return "downgrade";
  }
  return "upgrade";
}

/**
 * Parámetros del subscriptions.update. INVARIANTE: sin billing_cycle_anchor —
 * la fecha de renovación NO se mueve y en ella se cobra el periodo completo
 * del plan nuevo. UPGRADE: always_invoice (cobra el diferencial AHORA) +
 * error_if_incomplete (si la tarjeta rechaza, el plan NO cambia). DOWNGRADE:
 * create_prorations (crédito a la próxima factura).
 */
export function buildBarberSubscriptionUpdateParams(args: {
  itemId: string;
  priceId: string;
  direction: BarberChangeDirection;
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

export interface PreviewLineRaw {
  proration?: boolean;
  amount?: number | null;
  description?: string | null;
  period?: { start?: number | null; end?: number | null } | null;
}

/** Una factura de prorrateo SIEMPRE trae líneas proration:true. */
export function hasProrationLines(lines: PreviewLineRaw[]): boolean {
  return lines.some((l) => l.proration);
}

/** ¿La simulación trae además la RENOVACIÓN del próximo ciclo? (inflaría el "hoy"). */
export function hasRenewalLine(lines: PreviewLineRaw[], currentPeriodEndSeconds: number | null | undefined): boolean {
  if (!currentPeriodEndSeconds) return false;
  const threshold = currentPeriodEndSeconds - 60;
  return lines.some((l) => !l.proration && (l.period?.start ?? 0) >= threshold);
}

/** Centavos a cobrar HOY según la simulación; null = la simulación no es la del cobro inmediato. */
export function previewAmountDueCents(
  invoice: { amount_due?: number | null; lines?: { data?: PreviewLineRaw[] } | null } | null | undefined,
  currentPeriodEndSeconds?: number | null,
): number | null {
  const lines = invoice?.lines?.data ?? [];
  if (!hasProrationLines(lines)) return null;
  if (hasRenewalLine(lines, currentPeriodEndSeconds)) return null;
  return Math.max(0, invoice?.amount_due ?? 0);
}

export interface BarberPreviewLine {
  kind: "credit" | "charge" | "other";
  amountCents: number;
  description: string | null;
}

export function mapPreviewLines(lines: PreviewLineRaw[]): BarberPreviewLine[] {
  return lines.map((l) => {
    const amountCents = l.amount ?? 0;
    if (l.proration) return { kind: amountCents < 0 ? "credit" : "charge", amountCents, description: null };
    return { kind: "other", amountCents, description: l.description ?? null };
  });
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

export type BarberChargeFailureReason =
  | "insufficient_funds"
  | "expired_card"
  | "incorrect_cvc"
  | "authentication_required"
  | "declined";

/** ¿El error de Stripe es un FALLO DE COBRO (y no un request inválido nuestro)? */
export function isStripeChargeFailure(err: unknown): boolean {
  const e = err as { type?: string; code?: string; raw?: { code?: string; payment_intent?: unknown } } | null;
  if (!e) return false;
  if (e.type === "StripeCardError") return true;
  const code = e.code ?? e.raw?.code;
  if (code && CHARGE_ERROR_CODES.has(code)) return true;
  return !!e.raw?.payment_intent;
}

export function chargeFailureReason(err: unknown): BarberChargeFailureReason {
  const e = err as { code?: string; decline_code?: string; raw?: { code?: string; decline_code?: string } } | null;
  const code = e?.code ?? e?.raw?.code;
  const decline = e?.decline_code ?? e?.raw?.decline_code;
  if (decline === "insufficient_funds" || code === "insufficient_funds") return "insufficient_funds";
  if (code === "expired_card") return "expired_card";
  if (code === "incorrect_cvc") return "incorrect_cvc";
  if (
    code === "authentication_required" ||
    code === "payment_intent_authentication_failure" ||
    code === "subscription_payment_intent_requires_action" ||
    code === "invoice_payment_intent_requires_action"
  ) {
    return "authentication_required";
  }
  return "declined";
}

type LiveSubscription = Stripe.Subscription & SubscriptionLike;

async function loadLiveSubscription(stripe: Stripe, shop: BarberBillingShop): Promise<LiveSubscription> {
  if (!shop.stripeSubscriptionId) {
    throw new BarberBillingError("NO_SUBSCRIPTION", 409, "Aún no tienes una suscripción: contrata un plan primero.");
  }
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(shop.stripeSubscriptionId, SUB_EXPAND as never);
  } catch (err: any) {
    const code = err?.code ?? err?.raw?.code;
    if (code === "resource_missing") {
      throw new BarberBillingError(
        "SUBSCRIPTION_MISSING",
        409,
        "Tu suscripción ya no existe en Stripe. Vuelve a contratar el plan que quieras.",
      );
    }
    throw new BarberBillingError("STRIPE_ERROR", 502, err?.message ?? "Stripe no respondió.");
  }
  if (!isLiveBarberSubscriptionStatus(sub.status)) {
    throw new BarberBillingError(
      "SUBSCRIPTION_NOT_LIVE",
      409,
      `Tu suscripción no está activa (${sub.status}). Vuelve a contratar el plan que quieras.`,
      { status: sub.status },
    );
  }
  return sub as LiveSubscription;
}

export interface BarberPlanChangePreview {
  direction: BarberChangeDirection;
  interval: BarberBillingInterval;
  currency: string;
  /** Centavos a cobrar HOY (0 en downgrade). */
  amountDueNowCents: number;
  /** Centavos del periodo completo del plan destino en la renovación. */
  nextAmountCents: number;
  nextBillingDate: string | null;
  lines: BarberPreviewLine[];
  /** true = no se pudo simular; el importe exacto no está disponible. */
  unavailable: boolean;
}

/** Simula el cambio de plan sin ningún efecto (no toca la suscripción ni la BD). */
export async function previewBarberPlanChange(args: {
  stripe: Stripe;
  shop: BarberBillingShop;
  currentPlan: BarberResolvedPlan;
  targetPlan: BarberResolvedPlan;
}): Promise<BarberPlanChangePreview> {
  const { stripe, shop, currentPlan, targetPlan } = args;
  const sub = await loadLiveSubscription(stripe, shop);
  const item = sub.items.data[0];
  if (!item) throw new BarberBillingError("NO_ITEMS", 409, "Suscripción sin conceptos en Stripe.");

  const interval = subscriptionInterval(sub);
  const targetCents = planAmountCents(targetPlan, interval);
  if (targetCents === null) {
    throw new BarberBillingError(
      "INTERVAL_UNAVAILABLE",
      400,
      `El plan ${targetPlan.name} no tiene precio ${interval === "year" ? "anual" : "mensual"} configurado.`,
    );
  }
  const currentCents = item.price.unit_amount ?? planAmountCents(currentPlan, interval) ?? 0;
  const direction = resolveBarberChangeDirection({
    currentCents,
    targetCents,
    currentPlanId: shop.plan,
    targetPlanId: targetPlan.id,
  });
  const periodEnd = subscriptionPeriodEndSeconds(sub);
  const baseline: BarberPlanChangePreview = {
    direction,
    interval,
    currency: (item.price.currency ?? BARBER_CURRENCY).toUpperCase(),
    amountDueNowCents: 0,
    nextAmountCents: targetCents,
    nextBillingDate: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    lines: [],
    unavailable: false,
  };
  if (direction !== "upgrade") return baseline;

  const priceId = await ensureBarberStripePrice(stripe, targetPlan, interval);
  let invoice: any = null;
  try {
    invoice = await (stripe.invoices as any).createPreview({
      customer: shop.stripeCustomerId ?? undefined,
      subscription: sub.id,
      subscription_details: {
        items: [{ id: item.id, price: priceId, quantity: item.quantity ?? 1 }],
        proration_behavior: "always_invoice",
      },
    });
  } catch (err: any) {
    try {
      invoice = await stripe.rawRequest("GET", "/v1/invoices/upcoming", {
        subscription: sub.id,
        subscription_items: [{ id: item.id, price: priceId, quantity: item.quantity ?? 1 }],
        subscription_proration_behavior: "always_invoice",
      } as any);
    } catch (err2: any) {
      console.warn("[barber billing] preview no disponible:", err?.message, "/", err2?.message);
    }
  }
  if (!invoice) return { ...baseline, unavailable: true };
  const lines: PreviewLineRaw[] = invoice.lines?.data ?? [];
  const amountDueNowCents = previewAmountDueCents(invoice, periodEnd);
  if (amountDueNowCents === null) return { ...baseline, unavailable: true };
  return {
    ...baseline,
    currency: (invoice.currency ?? item.price.currency ?? BARBER_CURRENCY).toUpperCase(),
    amountDueNowCents,
    lines: mapPreviewLines(lines),
  };
}

export interface BarberPlanChangeResult {
  plan: BarberPlanId;
  status: string;
  direction: BarberChangeDirection;
  chargedNow: boolean;
}

/**
 * Ejecuta el cambio de plan sobre la suscripción viva y aplica el resultado
 * a la barbería (matriz + sucursales). Sin idempotencyKey a propósito: una
 * clave estable haría que Stripe repitiera el error cacheado cuando el usuario
 * corrige su tarjeta; el doble clic es inocuo (con el precio ya puesto un
 * segundo update no prorratea nada).
 */
export async function changeBarberPlan(args: {
  stripe: Stripe;
  db: BarberBillingDb;
  shop: BarberBillingShop;
  currentPlan: BarberResolvedPlan;
  targetPlan: BarberResolvedPlan;
  plans: BarberResolvedPlan[];
}): Promise<BarberPlanChangeResult> {
  const { stripe, db, shop, currentPlan, targetPlan } = args;
  if (!targetPlan.isActive) {
    throw new BarberBillingError("PLAN_INACTIVE", 400, `El plan ${targetPlan.name} ya no está disponible.`);
  }
  const sub = await loadLiveSubscription(stripe, shop);
  const item = sub.items.data[0];
  if (!item) throw new BarberBillingError("NO_ITEMS", 409, "Suscripción sin conceptos en Stripe.");

  const interval = subscriptionInterval(sub);
  const targetCents = planAmountCents(targetPlan, interval);
  if (targetCents === null) {
    throw new BarberBillingError(
      "INTERVAL_UNAVAILABLE",
      400,
      `El plan ${targetPlan.name} no tiene precio ${interval === "year" ? "anual" : "mensual"} configurado.`,
    );
  }
  const currentCents = item.price.unit_amount ?? planAmountCents(currentPlan, interval) ?? 0;
  const direction = resolveBarberChangeDirection({
    currentCents,
    targetCents,
    currentPlanId: shop.plan,
    targetPlanId: targetPlan.id,
  });
  const priceId = await ensureBarberStripePrice(stripe, targetPlan, interval);

  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(
      sub.id,
      {
        ...buildBarberSubscriptionUpdateParams({
          itemId: item.id,
          priceId,
          direction,
          metadata: {
            ...(sub.metadata ?? {}),
            dc_vertical: BARBER_STRIPE_VERTICAL,
            dc_kind: BARBER_STRIPE_KIND,
            barbershopId: shop.id,
            dc_plan: targetPlan.id,
            dc_interval: interval,
          },
        }),
        expand: ["items.data.price"],
      } as Stripe.SubscriptionUpdateParams,
    );
  } catch (err: any) {
    if (isStripeChargeFailure(err)) {
      throw new BarberBillingError(
        "UPGRADE_PAYMENT_FAILED",
        402,
        "No se pudo cobrar la diferencia del cambio de plan. Tu plan NO cambió.",
        { reason: chargeFailureReason(err) },
      );
    }
    throw new BarberBillingError("STRIPE_ERROR", 502, err?.message ?? "Stripe rechazó el cambio de plan.");
  }

  // La suscripción actualizada ya trae el precio nuevo (con dc_plan) → la
  // misma aplicación que usa el webhook, para no divergir.
  await applyBarberSubscription(db, updated as unknown as SubscriptionLike, { plans: args.plans });
  return { plan: targetPlan.id, status: updated.status, direction, chargedNow: direction === "upgrade" };
}

// ── Cancelar / reanudar ──────────────────────────────────────────────────

/**
 * cancel=true → cancel_at_period_end (el plan sigue hasta el fin del periodo
 * pagado; Stripe manda customer.subscription.deleted al terminar). cancel=false
 * → reanuda antes de que termine.
 */
export async function setBarberSubscriptionCancel(
  stripe: Stripe,
  db: BarberBillingDb,
  shop: BarberBillingShop,
  cancel: boolean,
  plans: BarberResolvedPlan[],
): Promise<{ status: string; cancelAtPeriodEnd: boolean; currentPeriodEndAt: string | null }> {
  const sub = await loadLiveSubscription(stripe, shop);
  const updated = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: cancel,
    expand: ["items.data.price"],
  } as Stripe.SubscriptionUpdateParams);
  await applyBarberSubscription(db, updated as unknown as SubscriptionLike, { plans });
  const periodEnd = subscriptionPeriodEndSeconds(updated as unknown as SubscriptionLike);
  return {
    status: updated.status,
    cancelAtPeriodEnd: updated.cancel_at_period_end,
    currentPeriodEndAt: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };
}

// ── Portal de facturación (configuración PROPIA de barber) ───────────────

let _portalConfigId: string | null = null;

/**
 * Configuración del portal SOLO para barber: actualizar tarjeta, ver
 * facturas y datos de contacto. SIN cambio de plan ni cancelación dentro de
 * Stripe (eso vive en /barber/suscripcion, con prorrateo y límites propios),
 * así un cliente barber jamás ve el catálogo del dental desde el portal.
 */
export async function ensureBarberPortalConfiguration(stripe: Stripe): Promise<string> {
  if (_portalConfigId) return _portalConfigId;
  const existing = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  const ours = existing.data.find((c) => c.metadata?.dc_vertical === BARBER_STRIPE_VERTICAL);
  if (ours) {
    _portalConfigId = ours.id;
    return ours.id;
  }
  const created = await stripe.billingPortal.configurations.create(
    {
      business_profile: { headline: "DaleControl Barber" },
      features: {
        customer_update: { enabled: true, allowed_updates: ["email", "address", "phone", "name"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
      },
      metadata: { dc_vertical: BARBER_STRIPE_VERTICAL },
    },
    { idempotencyKey: "dcbarber-portal-config-v1" },
  );
  _portalConfigId = created.id;
  return created.id;
}

export async function createBarberPortalSession(
  stripe: Stripe,
  shop: BarberBillingShop,
  returnUrl: string,
): Promise<string> {
  if (!shop.stripeCustomerId) {
    throw new BarberBillingError("NO_CUSTOMER", 400, "Aún no hay un método de pago: contrata un plan primero.");
  }
  const configuration = await ensureBarberPortalConfiguration(stripe);
  const session = await stripe.billingPortal.sessions.create({
    customer: shop.stripeCustomerId,
    configuration,
    return_url: returnUrl,
  });
  return session.url;
}

// ── Resumen para el panel (suscripción, tarjeta, facturas, cobros fallidos) ──

export interface BarberInvoiceSummary {
  id: string;
  number: string | null;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  createdAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  attemptCount: number;
  nextPaymentAttemptAt: string | null;
  /** true = Stripe intentó cobrarla y la tarjeta rechazó (sigue abierta) o quedó incobrable. */
  failed: boolean;
  failureMessage: string | null;
}

export interface BarberSubscriptionSummary {
  id: string;
  status: string;
  live: boolean;
  interval: BarberBillingInterval;
  planId: BarberPlanId | null;
  currentPeriodEndAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  paymentMethod: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  openInvoiceUrl: string | null;
}

export interface BarberBillingSummary {
  configured: boolean;
  /** Mensaje si Stripe no respondió (el panel sigue mostrando los planes). */
  stripeError: string | null;
  subscription: BarberSubscriptionSummary | null;
  invoices: BarberInvoiceSummary[];
  failedAttempts: BarberInvoiceSummary[];
}

function iso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function summarizeInvoice(inv: any): BarberInvoiceSummary {
  const pi = inv.payment_intent && typeof inv.payment_intent === "object" ? inv.payment_intent : null;
  const lastError = pi?.last_payment_error ?? null;
  const finalizationError = inv.last_finalization_error ?? null;
  const attemptCount = Number(inv.attempt_count ?? 0);
  const failed =
    (inv.status === "open" && attemptCount > 0) ||
    inv.status === "uncollectible" ||
    Boolean(lastError);
  const failureMessage =
    lastError?.decline_code ?? lastError?.code ?? lastError?.message ?? finalizationError?.message ?? null;
  return {
    id: inv.id,
    number: inv.number ?? null,
    status: inv.status ?? "unknown",
    amountDueCents: Number(inv.amount_due ?? 0),
    amountPaidCents: Number(inv.amount_paid ?? 0),
    currency: String(inv.currency ?? BARBER_CURRENCY).toUpperCase(),
    createdAt: iso(inv.created) ?? new Date(0).toISOString(),
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
    attemptCount,
    nextPaymentAttemptAt: iso(inv.next_payment_attempt),
    failed,
    failureMessage: failed ? failureMessage : null,
  };
}

export async function getBarberBillingSummary(
  stripe: Stripe | null,
  shop: BarberBillingShop,
  plans: BarberResolvedPlan[],
): Promise<BarberBillingSummary> {
  const empty: BarberBillingSummary = {
    configured: Boolean(stripe),
    stripeError: null,
    subscription: null,
    invoices: [],
    failedAttempts: [],
  };
  if (!stripe || !shop.stripeCustomerId) return empty;

  try {
    let subscription: BarberSubscriptionSummary | null = null;
    if (shop.stripeSubscriptionId) {
      try {
        const sub = (await stripe.subscriptions.retrieve(shop.stripeSubscriptionId, {
          expand: ["items.data.price", "default_payment_method", "latest_invoice"],
        })) as unknown as LiveSubscription & {
          default_payment_method?: any;
          latest_invoice?: any;
        };
        const pm = sub.default_payment_method && typeof sub.default_payment_method === "object"
          ? sub.default_payment_method
          : null;
        const card = pm?.card ?? null;
        const latest = sub.latest_invoice && typeof sub.latest_invoice === "object" ? sub.latest_invoice : null;
        subscription = {
          id: sub.id,
          status: sub.status,
          live: isLiveBarberSubscriptionStatus(sub.status),
          interval: subscriptionInterval(sub),
          planId: subscriptionPlanId(sub, plans),
          currentPeriodEndAt: iso(subscriptionPeriodEndSeconds(sub)),
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          cancelAt: iso(sub.cancel_at),
          canceledAt: iso(sub.canceled_at),
          paymentMethod: card
            ? { brand: String(card.brand ?? "card"), last4: String(card.last4 ?? ""), expMonth: Number(card.exp_month ?? 0), expYear: Number(card.exp_year ?? 0) }
            : null,
          openInvoiceUrl: latest && latest.status === "open" ? latest.hosted_invoice_url ?? null : null,
        };
      } catch (err: any) {
        const code = err?.code ?? err?.raw?.code;
        if (code !== "resource_missing") throw err;
        subscription = null; // borrada en Stripe: se muestra como sin suscripción
      }
    }

    // Facturas de la barbería (últimas 12). El expand del payment_intent trae
    // el motivo del rechazo; si la versión de API no lo admite, se reintenta
    // sin él (la visibilidad del fallo se conserva vía attempt_count/status).
    let invoicesRaw: any[] = [];
    try {
      const res = await stripe.invoices.list({
        customer: shop.stripeCustomerId,
        limit: 12,
        expand: ["data.payment_intent"],
      } as any);
      invoicesRaw = res.data;
    } catch {
      const res = await stripe.invoices.list({ customer: shop.stripeCustomerId, limit: 12 });
      invoicesRaw = res.data;
    }
    const invoices = invoicesRaw.map(summarizeInvoice);
    return {
      configured: true,
      stripeError: null,
      subscription,
      invoices,
      failedAttempts: invoices.filter((i) => i.failed),
    };
  } catch (err: any) {
    console.error("[barber billing] resumen no disponible:", err?.message ?? err);
    return { ...empty, stripeError: err?.message ?? "Stripe no respondió." };
  }
}

/** Base pública para success/cancel/return URLs (mismo criterio que el dental). */
export function resolveBarberBaseUrl(requestUrl: string): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? new URL(requestUrl).origin;
}
