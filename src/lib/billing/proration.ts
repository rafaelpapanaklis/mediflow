/**
 * Prorrateo de cambios de plan de la plataforma.
 *
 * Módulo PURO (sin prisma, sin cliente de Stripe): lo importan la ruta de
 * cambio de plan, el preview del cobro y el webhook. Solo tipos de Stripe.
 *
 * CONTRATO DE NEGOCIO (upgrade con suscripción de tarjeta viva):
 *   • El diferencial de los días que quedan del periodo se cobra AHORA
 *     (`proration_behavior: "always_invoice"`).
 *   • La fecha de renovación NO se mueve: jamás se fija el ancla del ciclo de
 *     facturación, así Stripe conserva el `current_period_end` original y en esa
 *     fecha cobra el periodo COMPLETO del plan nuevo.
 *   • Si la tarjeta rechaza, la operación falla entera
 *     (`payment_behavior: "error_if_incomplete"`): el plan superior NO queda
 *     aplicado gratis.
 * En DOWNGRADE se conserva `create_prorations` (el crédito a favor se aplica a
 * la próxima factura; no se emite nota de crédito inmediata).
 */

export type BillingInterval = "month" | "year";

/** Statuses de una suscripción de Stripe que todavía se puede modificar/cobrar. */
export const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "unpaid"] as const;

export function isLiveSubscriptionStatus(status: string | null | undefined): boolean {
  return !!status && (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * `metadata.kind` del Checkout de diferencial de plan para clínicas SIN
 * suscripción de tarjeta (SPEI/OXXO ya pagado). El webhook lo usa para aplicar
 * el plan SOLO cuando el pago se confirma.
 */
export const PLAN_UPGRADE_DIFF_KIND = "plan-upgrade-diff";

/**
 * Días nominales del periodo para el prorrateo MANUAL (SPEI/OXXO). No hay
 * suscripción en Stripe, así que no existe un `current_period_start` real: el
 * denominador es el nominal del ciclo que compró la clínica.
 */
export const MANUAL_PERIOD_DAYS: Record<BillingInterval, number> = { month: 30, year: 365 };

/**
 * Mínimo cobrable en MXN (centavos). Stripe rechaza cargos por debajo de ~$10
 * MXN. Un diferencial menor NO se cobra: se aplica el plan y ya (el costo de
 * fricción supera el ingreso).
 */
export const MIN_CHARGEABLE_CENTS = 1000;

const DAY_MS = 86_400_000;

/** Importe del plan (centavos) para el intervalo dado. */
export function planAmountCents(
  plan: { priceMxn: number; priceMxnAnnual: number },
  interval: BillingInterval,
): number {
  return Math.round((interval === "year" ? plan.priceMxnAnnual : plan.priceMxn) * 100);
}

/** Días que faltan hasta `until` (redondeo hacia arriba; 0 si ya pasó). */
export function daysRemainingUntil(
  until: Date | string | number | null | undefined,
  now: Date = new Date(),
): number {
  if (until === null || until === undefined) return 0;
  const end = typeof until === "number" ? new Date(until * 1000) : new Date(until);
  const ms = end.getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

/**
 * Diferencial prorrateado para clínicas sin suscripción de tarjeta:
 * (destino − actual) × díasRestantes / díasDelPeriodo. Nunca negativo — un
 * downgrade manual no genera devolución por esta vía.
 *
 * NO se limita el ratio a 1: si la clínica prepagó varios periodos, los días
 * extra también se prorratean (es el mismo precio por día, aplicado a más días).
 */
export function manualUpgradeDiffCents(args: {
  currentCents: number;
  targetCents: number;
  daysRemaining: number;
  periodDays: number;
}): number {
  const { currentCents, targetCents, daysRemaining, periodDays } = args;
  const delta = targetCents - currentCents;
  if (delta <= 0 || daysRemaining <= 0 || periodDays <= 0) return 0;
  return Math.round((delta * daysRemaining) / periodDays);
}

/**
 * ¿Una factura fallida debe SUSPENDER a la clínica (`subscriptionStatus:
 * "past_due"`, que la saca de ACTIVE_SUBSCRIPTION_STATUSES y le bloquea el
 * panel)?
 *
 * SOLO la mensualidad/anualidad. Un prorrateo rechazado llega con
 * `billing_reason: "subscription_update"` — es el diferencial de un intento de
 * SUBIR de plan, y perder el acceso al plan que ya paga por intentar mejorarlo
 * sería absurdo. Los demás motivos (manual, threshold, quote…) tampoco
 * suspenden: se registran en la bitácora y ya.
 */
export function canSuspendForFailedInvoice(billingReason: string | null | undefined): boolean {
  return billingReason === "subscription_cycle" || billingReason === "subscription_create";
}

/**
 * Ciclo COMPRADO a partir de filas de bitácora ordenadas de la más reciente a la
 * más antigua. Devuelve null si ninguna lo registra.
 *
 * Solo `/api/billing/checkout` graba el ciclo comprado (`_created.after.billing`
 * = "monthly" | "annual"). Hay OTRAS filas con el mismo `entityType`/`action`
 * ("subscription"/"create") que NO lo traen — p. ej. el Checkout del diferencial
 * de plan — y esas deben IGNORARSE, no interpretarse como mensuales: leer una
 * fila sin `billing` como "monthly" hacía que a una clínica ANUAL se le
 * prorrateara sobre 30 días con `daysRemaining` de un periodo anual, cobrándole
 * de más. Por eso este helper SALTA las filas sin dato en vez de rendirse en la
 * primera.
 */
export function pickPurchasedInterval(changesNewestFirst: unknown[]): BillingInterval | null {
  for (const changes of changesNewestFirst) {
    const billing = (changes as { _created?: { after?: { billing?: unknown } } } | null)?._created
      ?.after?.billing;
    if (billing === "annual") return "year";
    if (billing === "monthly") return "month";
  }
  return null;
}

/** Dirección del cambio comparando importes del MISMO intervalo. */
export function changeDirection(
  currentCents: number,
  targetCents: number,
): "upgrade" | "downgrade" | "same" {
  if (targetCents > currentCents) return "upgrade";
  if (targetCents < currentCents) return "downgrade";
  return "same";
}

/** Códigos de Stripe que significan "no se pudo cobrar" (no "request inválido"). */
const PAYMENT_ERROR_CODES = new Set([
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
  "invoice_not_editable",
  "missing",
]);

/**
 * ¿Este error de Stripe es un FALLO DE COBRO (tarjeta rechazada / requiere
 * autenticación) y no un bug nuestro? Con `error_if_incomplete` Stripe lanza
 * `StripeCardError` cuando la tarjeta rechaza, y un `invalid_request_error` con
 * código de SCA cuando el cargo requiere autenticación del titular.
 */
export function isStripeChargeFailure(err: unknown): boolean {
  const e = err as { type?: string; code?: string; raw?: { code?: string; payment_intent?: unknown } } | null;
  if (!e) return false;
  if (e.type === "StripeCardError") return true;
  const code = e.code ?? e.raw?.code;
  if (code && PAYMENT_ERROR_CODES.has(code)) return true;
  return !!e.raw?.payment_intent;
}

/** Mensaje en español, apto para el usuario final, de un fallo de cobro. */
export function chargeFailureMessage(err: unknown): string {
  const e = err as { code?: string; decline_code?: string; raw?: { code?: string; decline_code?: string } } | null;
  const code = e?.code ?? e?.raw?.code;
  const decline = e?.decline_code ?? e?.raw?.decline_code;
  const base = "No se pudo cobrar la diferencia del upgrade. Tu plan NO cambió.";
  if (decline === "insufficient_funds" || code === "insufficient_funds") {
    return `${base} Tu tarjeta reportó fondos insuficientes; intenta con otra tarjeta.`;
  }
  if (code === "expired_card") return `${base} Tu tarjeta está vencida; actualízala e intenta de nuevo.`;
  if (code === "incorrect_cvc") return `${base} El código de seguridad no coincide.`;
  if (
    code === "authentication_required" ||
    code === "payment_intent_authentication_failure" ||
    code === "subscription_payment_intent_requires_action" ||
    code === "invoice_payment_intent_requires_action"
  ) {
    return `${base} Tu banco pidió autenticación del cargo: paga la factura pendiente desde "Portal Stripe" y vuelve a intentar.`;
  }
  return `${base} Tu banco rechazó el cargo; revisa tu método de pago e intenta de nuevo.`;
}
