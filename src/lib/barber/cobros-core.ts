import { Prisma } from "@prisma/client";
import {
  BARBER_ACTIVE_SUBSCRIPTION_STATUSES,
  barberPlanRank,
  isBarberPlanId,
  type BarberPlanId,
} from "@/lib/barber/plan-shared";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — COBROS de la suscripción y CORTE sin días de gracia.
 *
 * Puro: sin prisma ni "server-only" (se prueba con `tsx --test`). La parte
 * con base de datos vive en cobros.ts; la de Stripe, en billing.ts.
 *
 * Decisiones de Rafael (15-nov-2026):
 *  #5  Registrar cada pago de las barberías: «cobrado este mes» en el admin
 *      y el ingreso = lo que cobra Stripe, no el precio de lista.
 *  #10 Ningún día de gracia: cuando termina el día completo (de México) del
 *      aniversario y no hay cobro nuevo, la barbería queda SUSPENDIDA y solo
 *      puede reactivarse pagando ESE plan (o uno mayor).
 *
 * EL CORTE (ver barberiaVencida)
 *   «Pagado hasta» = el `period_end` más tardío de sus cobros PAGADOS. Si la
 *   fecha de HOY en México es posterior a la fecha de México de ese
 *   «pagado hasta», el periodo pagado terminó ayer o antes: suspendida.
 *   Contratada el 14-nov → paga hasta el 14-dic → el 14-dic todavía trabaja
 *   → el 15-dic a las 00:00 (México) queda cerrada si no entró el cobro.
 *   No depende de que Stripe reintente, ni de que llegue un webhook: es una
 *   fecha que ya tenemos guardada.
 *
 *   Sin ningún cobro registrado (tabla sin pegar, barbería de cortesía, o
 *   la que pagó antes de que existiera el registro) el corte NO aplica y
 *   manda el estado de siempre: nada se cierra por falta de datos.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** El día que cuenta para el corte es el de México (decisión #10). */
export const BARBER_COBRO_TZ = "America/Mexico_City";

/**
 * Estado que se escribe en la barbería al vencer su periodo pagado. Es el de
 * Stripe para «pago vencido»: la pantalla de Suscripción ya sabe pintarlo
 * (aviso rojo + «Pagar factura pendiente») y el candado ya lo cierra.
 */
export const BARBER_VENCIDA_STATUS = "past_due";

export type BarberCobroStatus = "paid" | "failed";
export type BarberCobroInterval = "month" | "year";

// ── Fechas de México ─────────────────────────────────────────────────────

const FECHA_MX = new Intl.DateTimeFormat("en-CA", {
  timeZone: BARBER_COBRO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "AAAA-MM-DD" del día de México en que cae ese instante. */
export function fechaMexico(d: Date): string {
  return FECHA_MX.format(d);
}

/** ¿El día (México) de `pagadoHasta` ya terminó en `now`? */
export function periodoPagadoVencido(pagadoHasta: Date | null | undefined, now: Date): boolean {
  if (!pagadoHasta) return false;
  return fechaMexico(now) > fechaMexico(pagadoHasta);
}

// ── El registro de una barbería ──────────────────────────────────────────

export interface BarberLedger {
  /** period_end más tardío de sus cobros pagados (null = ningún cobro). */
  paidThroughAt: Date | null;
  /** paid_at del cobro pagado más reciente. */
  lastPaidAt: Date | null;
  /** Reactivación manual desde el admin (barber_subscriptions.manual_access_at). */
  manualAccessAt: Date | null;
}

/**
 * ¿El corte por fecha aplica a esta barbería? Hace falta un cobro pagado
 * registrado; y una reactivación MANUAL posterior al último cobro la exime
 * (es cortesía de DaleControl) hasta que entre un cobro nuevo.
 */
export function corteAplica(ledger: BarberLedger | null | undefined): boolean {
  if (!ledger?.paidThroughAt) return false;
  const manual = ledger.manualAccessAt;
  if (manual && (!ledger.lastPaidAt || manual.getTime() > ledger.lastPaidAt.getTime())) return false;
  return true;
}

/** ¿Terminó su periodo pagado sin cobro nuevo? (el corte sin días de gracia) */
export function barberiaVencida(ledger: BarberLedger | null | undefined, now: Date): boolean {
  return corteAplica(ledger) && periodoPagadoVencido(ledger!.paidThroughAt, now);
}

/**
 * Estado que se ESCRIBE en la barbería. Igual al de Stripe, salvo que Stripe
 * todavía diga «al corriente» (active/trialing/paid) con el periodo pagado
 * vencido: entonces «past_due». Lo que ya no da acceso (past_due, canceled,
 * suspended…) pasa tal cual: el corte solo cierra, nunca abre.
 */
export function estadoEfectivo(
  status: string,
  ledger: BarberLedger | null | undefined,
  now: Date,
): string {
  if (!BARBER_ACTIVE_SUBSCRIPTION_STATUSES.has(status)) return status;
  return barberiaVencida(ledger, now) ? BARBER_VENCIDA_STATUS : status;
}

// ── Reactivar = pagar el MISMO plan (o uno mayor) ────────────────────────

/** Estados de quien nunca cerró un cobro: eligen plan libremente. */
const NUNCA_PAGO = new Set(["pending_payment", "incomplete", "incomplete_expired"]);

/**
 * ¿Esta barbería está SUSPENDIDA tras haber pagado? (y por tanto solo puede
 * reactivarse con su plan o uno mayor). Una alta nueva que nunca pagó elige
 * el plan que quiera; una al corriente baja de plan como siempre.
 *
 *  · `tieneAcceso`: el candado de pago de hoy (hasBarberPaidAccess).
 *  · Pagó antes = hay un cobro pagado registrado, o (sin registro) tuvo una
 *    suscripción de Stripe que llegó a cobrar (no se quedó en «incomplete»).
 */
export function suspendidaTrasPagar(args: {
  tieneAcceso: boolean;
  subscriptionStatus: string | null | undefined;
  stripeSubscriptionId: string | null | undefined;
  ledger: BarberLedger | null | undefined;
}): boolean {
  if (args.tieneAcceso) return false;
  if (args.ledger?.lastPaidAt) return true;
  if (!args.stripeSubscriptionId) return false;
  return !NUNCA_PAGO.has(args.subscriptionStatus ?? "pending_payment");
}

/** ¿`target` es el plan que tenía o uno mayor? Un plan desconocido no frena. */
export function planPermitidoParaReactivar(planActual: string | null | undefined, target: BarberPlanId): boolean {
  if (!isBarberPlanId(planActual)) return true;
  return barberPlanRank(target) >= barberPlanRank(planActual);
}

// ── Lectura PURA de una factura de Stripe ────────────────────────────────

export const BARBER_COBRO_VERTICAL = "barber";
export const BARBER_COBRO_KIND = "barber-subscription";

type Meta = Record<string, string> | null | undefined;

interface InvoiceLineLike {
  amount?: number | null;
  proration?: boolean | null;
  type?: string | null;
  subscription?: string | { id?: string } | null;
  period?: { start?: number | null; end?: number | null } | null;
  price?: {
    id?: string;
    unit_amount?: number | null;
    recurring?: { interval?: string | null } | null;
    metadata?: Meta;
    product?: string | { metadata?: Meta } | null;
  } | null;
  /** API nueva: el precio viaja en pricing.price_details. */
  pricing?: { price_details?: { price?: string | null } | null } | null;
}

export interface InvoiceLike {
  id: string;
  status?: string | null;
  customer?: string | { id?: string } | null;
  subscription?: string | { id?: string; metadata?: Meta } | null;
  subscription_details?: { metadata?: Meta } | null;
  parent?: { subscription_details?: { subscription?: string | null; metadata?: Meta } | null } | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  currency?: string | null;
  created?: number | null;
  status_transitions?: { paid_at?: number | null } | null;
  lines?: { data?: InvoiceLineLike[] | null } | null;
  payment_intent?: string | { last_payment_error?: { code?: string | null; decline_code?: string | null } | null } | null;
  last_finalization_error?: { code?: string | null } | null;
}

function metaVertical(meta: Meta): boolean {
  return meta?.dc_vertical === BARBER_COBRO_VERTICAL;
}

function priceIsBarber(line: InvoiceLineLike): boolean {
  const price = line.price;
  if (!price) return false;
  if (metaVertical(price.metadata)) return true;
  const product = price.product && typeof price.product === "object" ? price.product : null;
  return metaVertical(product?.metadata);
}

function subscriptionMeta(inv: InvoiceLike): Meta {
  return (
    inv.subscription_details?.metadata ??
    inv.parent?.subscription_details?.metadata ??
    (inv.subscription && typeof inv.subscription === "object" ? inv.subscription.metadata : null) ??
    null
  );
}

/**
 * ¿Es una factura de la suscripción de DaleControl Barber? La misma cuenta de
 * Stripe cobra el dental y las membresías de T4: solo pasa lo que lleva
 * NUESTRA marca (metadata de la suscripción o del precio). Una membresía de
 * T4 marca su suscripción con `dcb`, nunca con dc_kind = barber-subscription.
 */
export function esFacturaBarber(inv: InvoiceLike | null | undefined): boolean {
  if (!inv) return false;
  const meta = subscriptionMeta(inv);
  if (meta) {
    if (meta.dcb) return false; // membresía de T4 (payments.ts)
    if (meta.dc_kind && meta.dc_kind !== BARBER_COBRO_KIND) return false;
    if (metaVertical(meta)) return true;
  }
  return (inv.lines?.data ?? []).some(priceIsBarber);
}

export function facturaSubscriptionId(inv: InvoiceLike): string | null {
  if (typeof inv.subscription === "string") return inv.subscription;
  if (inv.subscription && typeof inv.subscription === "object" && inv.subscription.id) return inv.subscription.id;
  return inv.parent?.subscription_details?.subscription ?? null;
}

export function facturaCustomerId(inv: InvoiceLike): string | null {
  if (!inv.customer) return null;
  return typeof inv.customer === "string" ? inv.customer : inv.customer.id ?? null;
}

export function facturaShopIdDeclarado(inv: InvoiceLike): string | null {
  return subscriptionMeta(inv)?.barbershopId ?? null;
}

export interface BarberCobro {
  invoiceId: string;
  subscriptionId: string | null;
  status: BarberCobroStatus;
  amountCents: number;
  currency: string;
  planId: BarberPlanId | null;
  interval: BarberCobroInterval | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  failureCode: string | null;
}

function fromSeconds(s: number | null | undefined): Date | null {
  return typeof s === "number" && s > 0 ? new Date(s * 1000) : null;
}

/**
 * Lo que se guarda de una factura. `status` sale de la factura VIVA: pagada
 * → 'paid'; si no está pagada y el evento es un rechazo → 'failed'; si no
 * (borrador, abierta sin intento) → null y no se guarda nada.
 *
 * El periodo es el de las líneas de la suscripción (el de servicio), NO
 * `invoice.period_*`: en una renovación ése es el periodo ANTERIOR.
 */
export function leerCobroDeFactura(inv: InvoiceLike, eventType: string): BarberCobro | null {
  const paid = inv.status === "paid";
  const failed =
    !paid && eventType === "invoice.payment_failed" && inv.status !== "draft" && inv.status !== "void";
  if (!paid && !failed) return null;

  const lines = (inv.lines?.data ?? []).filter((l) => l.price?.recurring || l.period);
  let start: number | null = null;
  let end: number | null = null;
  for (const l of lines) {
    const s = l.period?.start ?? null;
    const e = l.period?.end ?? null;
    if (s !== null && (start === null || s < start)) start = s;
    if (e !== null && (end === null || e > end)) end = e;
  }

  // El plan y el ciclo: la línea normal de la suscripción; si la factura es
  // solo de prorrateo (subir de plan), la línea positiva más grande.
  const recurring = lines.filter((l) => l.price?.recurring);
  const main =
    recurring.find((l) => !l.proration) ??
    [...recurring].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0] ??
    null;
  const planMeta = main?.price?.metadata?.dc_plan ?? subscriptionMeta(inv)?.dc_plan;
  const intervalRaw = main?.price?.recurring?.interval ?? subscriptionMeta(inv)?.dc_interval ?? null;

  const pi = inv.payment_intent && typeof inv.payment_intent === "object" ? inv.payment_intent : null;
  const failureCode = failed
    ? pi?.last_payment_error?.decline_code ?? pi?.last_payment_error?.code ?? inv.last_finalization_error?.code ?? null
    : null;

  const cents = paid ? inv.amount_paid : inv.amount_due;
  return {
    invoiceId: inv.id,
    subscriptionId: facturaSubscriptionId(inv),
    status: paid ? "paid" : "failed",
    amountCents: Math.max(0, Math.round(Number(cents ?? 0))),
    currency: String(inv.currency ?? "mxn").toLowerCase(),
    planId: isBarberPlanId(planMeta) ? planMeta : null,
    interval: intervalRaw === "year" ? "year" : intervalRaw === "month" ? "month" : null,
    periodStart: fromSeconds(start),
    periodEnd: fromSeconds(end),
    paidAt: paid ? fromSeconds(inv.status_transitions?.paid_at) ?? fromSeconds(inv.created) : null,
    failureCode,
  };
}

// ── Términos REALES de la suscripción (lo que Stripe cobra hoy) ──────────

interface SubscriptionTermsLike {
  id: string;
  status: string;
  cancel_at_period_end?: boolean | null;
  current_period_end?: number | null;
  metadata?: Meta;
  items?: {
    data?: Array<{
      quantity?: number | null;
      current_period_end?: number | null;
      price?: {
        unit_amount?: number | null;
        currency?: string | null;
        recurring?: { interval?: string | null } | null;
        metadata?: Meta;
      } | null;
    }> | null;
  } | null;
}

export interface BarberSuscripcionTerminos {
  stripeSubscriptionId: string;
  stripeStatus: string;
  /** unit_amount × quantity; null si Stripe no lo trae. */
  priceCents: number | null;
  currency: string | null;
  interval: BarberCobroInterval | null;
  planId: BarberPlanId | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export function terminosDeSuscripcion(sub: SubscriptionTermsLike): BarberSuscripcionTerminos {
  const item = sub.items?.data?.[0] ?? null;
  const unit = item?.price?.unit_amount;
  const qty = item?.quantity ?? 1;
  const interval = item?.price?.recurring?.interval;
  const planMeta = item?.price?.metadata?.dc_plan ?? sub.metadata?.dc_plan;
  return {
    stripeSubscriptionId: sub.id,
    stripeStatus: sub.status,
    priceCents: typeof unit === "number" ? Math.max(0, Math.round(unit * qty)) : null,
    currency: item?.price?.currency ? String(item.price.currency).toLowerCase() : null,
    interval: interval === "year" ? "year" : interval === "month" ? "month" : null,
    planId: isBarberPlanId(planMeta) ? planMeta : null,
    currentPeriodEnd: fromSeconds(item?.current_period_end ?? sub.current_period_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}

// ── Dinero para el admin (Decimal, nunca float) ──────────────────────────

/** Pesos al MES de una suscripción: centavos ÷ 100, y ÷ 12 si es anual. */
export function mensualDesdeCentavos(cents: number, interval: BarberCobroInterval | null): Prisma.Decimal {
  const pesos = new Prisma.Decimal(cents).div(100);
  return (interval === "year" ? pesos.div(12) : pesos).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Centavos enteros → pesos con 2 decimales (exacto). */
export function pesosDesdeCentavos(cents: number | bigint): Prisma.Decimal {
  return new Prisma.Decimal(String(cents)).div(100).toDecimalPlaces(2);
}
