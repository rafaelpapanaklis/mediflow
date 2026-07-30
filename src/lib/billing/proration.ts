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

import { PLAN_IDS } from "./plans";

export type BillingInterval = "month" | "year";

/** Precios de un plan resuelto (`getResolvedPlan`), en pesos. */
export interface PlanPricing {
  id: string;
  name: string;
  priceMxn: number;
  priceMxnAnnual: number;
}

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
 * "Pagado-hasta" REAL de una clínica sin suscripción de tarjeta: el mayor entre
 * `trialEndsAt` y `nextBillingDate`.
 *
 * No basta con `trialEndsAt`: las activaciones manuales del admin
 * (`/api/admin/billing`, acciones `verify_payment` y `activate_clinic`) escriben
 * `nextBillingDate` y dejan `trialEndsAt` intacto (vencido desde el registro).
 * Leer solo `trialEndsAt` daba 0 días restantes para una clínica que SÍ tiene
 * meses pagados, y el diferencial salía en cero: upgrade gratis.
 */
export function manualPaidUntil(clinic: {
  trialEndsAt?: Date | string | null;
  nextBillingDate?: Date | string | null;
}): Date | null {
  const dates = [clinic.trialEndsAt, clinic.nextBillingDate]
    .filter((d) => d !== null && d !== undefined)
    .map((d) => new Date(d as Date | string))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
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
 * Cotización del diferencial de un upgrade para clínicas SIN suscripción de
 * tarjeta (pagaron SPEI/OXXO: pago único, `stripeSubscriptionId` null).
 */
export interface ManualUpgradeQuote {
  interval: BillingInterval;
  periodDays: number;
  daysRemaining: number;
  currentCents: number;
  targetCents: number;
  direction: "upgrade" | "downgrade" | "same";
  /** Diferencial a cobrar en centavos MXN (0 si no hay nada que cobrar). */
  diffCents: number;
  /** true si el diferencial supera el mínimo que Stripe acepta cobrar. */
  chargeable: boolean;
  /** Fin del periodo pagado (no se mueve al mejorar el plan). */
  periodEnd: Date | null;
  /**
   * false = el ciclo comprado NO se pudo confirmar y se cotizó por el criterio
   * conservador (ver `computeManualUpgradeQuote`). Se audita.
   */
  intervalKnown: boolean;
}

function quoteForInterval(args: {
  interval: BillingInterval;
  paidUntil: Date | string | null | undefined;
  currentPlan: { priceMxn: number; priceMxnAnnual: number };
  targetPlan: { priceMxn: number; priceMxnAnnual: number };
  now: Date;
  intervalKnown: boolean;
}): ManualUpgradeQuote {
  const periodDays = MANUAL_PERIOD_DAYS[args.interval];
  const daysRemaining = daysRemainingUntil(args.paidUntil, args.now);
  const currentCents = planAmountCents(args.currentPlan, args.interval);
  const targetCents = planAmountCents(args.targetPlan, args.interval);
  const direction = changeDirection(currentCents, targetCents);

  const diffCents =
    direction === "upgrade"
      ? manualUpgradeDiffCents({ currentCents, targetCents, daysRemaining, periodDays })
      : 0;

  return {
    interval: args.interval,
    periodDays,
    daysRemaining,
    currentCents,
    targetCents,
    direction,
    diffCents,
    chargeable: diffCents >= MIN_CHARGEABLE_CENTS,
    periodEnd: args.paidUntil ? new Date(args.paidUntil) : null,
    intervalKnown: args.intervalKnown,
  };
}

/**
 * Núcleo PURO de la cotización manual: sin BD. `buildManualUpgradeQuote` es su
 * envoltura (resuelve el ciclo comprado desde la bitácora).
 *
 * `interval: null` = NO se pudo confirmar el ciclo que compró la clínica (la
 * activó un admin, o la bitácora no lo registra). En ese caso se cotiza en
 * AMBOS ciclos y se cobra el MENOR.
 *
 * Antes se caía a "month" asumiendo que era el que menos cobraba: es al revés.
 * El anual trae ~35% de descuento, así que su precio POR DÍA es mucho menor
 * (mensual 419/30 = $13.97/día vs anual 3264/365 = $8.94/día); cotizar como
 * mensual a una clínica anual la sobre-cobraba ~56% — el mismo error de
 * sobre-cobro que ya se corrigió una vez en el orden de las filas de bitácora,
 * escondido en el fallback. Tomar el mínimo cumple literalmente la promesa:
 * nunca cobramos de más por un dato que no pudimos confirmar.
 */
export function computeManualUpgradeQuote(args: {
  /** Ciclo comprado, o null si no se pudo confirmar. */
  interval: BillingInterval | null;
  /** "Pagado-hasta" de la clínica (Clinic.trialEndsAt). NO es un trial gratis. */
  paidUntil: Date | string | null | undefined;
  currentPlan: { priceMxn: number; priceMxnAnnual: number };
  targetPlan: { priceMxn: number; priceMxnAnnual: number };
  now?: Date;
}): ManualUpgradeQuote {
  const now = args.now ?? new Date();
  const base = { paidUntil: args.paidUntil, currentPlan: args.currentPlan, targetPlan: args.targetPlan, now };

  if (args.interval) {
    return quoteForInterval({ ...base, interval: args.interval, intervalKnown: true });
  }

  const monthly = quoteForInterval({ ...base, interval: "month", intervalKnown: false });
  const annual = quoteForInterval({ ...base, interval: "year", intervalKnown: false });
  return annual.diffCents < monthly.diffCents ? annual : monthly;
}

/**
 * ¿Una factura fallida debe SUSPENDER a la clínica (`subscriptionStatus`:
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

/**
 * Dirección del cambio para decidir SI SE COBRA HOY, con el tier como veto.
 *
 * El importe manda (es lo que Stripe va a prorratear), pero el precio que la
 * clínica tiene congelado en su suscripción puede haber quedado por ENCIMA del
 * precio actual de un plan superior: `plan_configs` es editable desde el admin y
 * hay clínicas con precio grandfathered. Sin el veto, BAJAR de plan podía
 * clasificarse "upgrade" y cobrarse hoy con `error_if_incomplete`, y el mensaje
 * de error hablaba de "la diferencia del upgrade" a alguien que se estaba
 * degradando.
 *
 * Regla: si el TIER baja, jamás es upgrade — se toma el camino que NO cobra de
 * inmediato (`create_prorations`, crédito a la próxima factura).
 */
export function resolveChangeDirection(args: {
  currentCents: number;
  targetCents: number;
  currentPlanId?: string | null;
  targetPlanId?: string | null;
}): "upgrade" | "downgrade" | "same" {
  const byAmount = changeDirection(args.currentCents, args.targetCents);
  if (byAmount !== "upgrade") return byAmount;
  const ids = PLAN_IDS as readonly string[];
  const currentTier = ids.indexOf(args.currentPlanId ?? "");
  const targetTier = ids.indexOf(args.targetPlanId ?? "");
  // Solo vetamos cuando AMBOS tiers son conocidos y el destino es inferior.
  if (currentTier >= 0 && targetTier >= 0 && targetTier < currentTier) return "downgrade";
  return "upgrade";
}

/**
 * ¿El plan que llega es un tier SUPERIOR al que tiene la clínica? `PLAN_IDS` es
 * el orden canónico (BASIC → PRO → CLINIC). Un plan desconocido en `current`
 * da índice -1, así que cualquier plan válido cuenta como subida.
 */
export function isPlanTierUpgrade(
  currentPlan: string | null | undefined,
  incomingPlan: string | null | undefined,
): boolean {
  const ids = PLAN_IDS as readonly string[];
  return ids.indexOf(incomingPlan ?? "") > ids.indexOf(currentPlan ?? "");
}

// ── Contrato con la API de Stripe (objetos que se ENVÍAN) ───────────────────

/**
 * Parámetros del `stripe.subscriptions.update` de un cambio de plan.
 *
 * INVARIANTE: `billing_cycle_anchor` NO existe en este tipo y jamás se agrega.
 * Fijarlo reiniciaría el ciclo y movería la fecha de renovación; su ausencia es
 * lo que hace que Stripe conserve `current_period_end` y cobre el periodo
 * COMPLETO del plan nuevo en la fecha original.
 */
export interface SubscriptionUpdateParams {
  items: Array<{ id: string; price: string }>;
  proration_behavior: "always_invoice" | "create_prorations";
  metadata: Record<string, string>;
  /** Solo en UPGRADE: si la tarjeta rechaza, la operación falla entera. */
  payment_behavior?: "error_if_incomplete";
}

/**
 * Arma el update de la suscripción según la dirección del cambio.
 *
 *  • upgrade   → `always_invoice` (cobra el prorrateo AHORA) +
 *                `error_if_incomplete` (si rechaza, NO queda el plan aplicado).
 *  • otro caso → `create_prorations` (crédito a la próxima factura) y SIN
 *                `payment_behavior`: un downgrade no cobra nada hoy, así que
 *                exigir un cobro exitoso lo haría fallar sin motivo.
 */
export function buildSubscriptionUpdateParams(args: {
  itemId: string;
  priceId: string;
  direction: "upgrade" | "downgrade" | "same";
  metadata: Record<string, string>;
}): SubscriptionUpdateParams {
  const isUpgrade = args.direction === "upgrade";
  return {
    items: [{ id: args.itemId, price: args.priceId }],
    proration_behavior: isUpgrade ? "always_invoice" : "create_prorations",
    metadata: args.metadata,
    ...(isUpgrade ? { payment_behavior: "error_if_incomplete" as const } : {}),
  };
}

/** Price on-the-fly del plan destino, SIEMPRE en el intervalo de la suscripción actual. */
export function buildTargetPriceParams(plan: PlanPricing, interval: BillingInterval) {
  return {
    currency: "mxn",
    unit_amount: planAmountCents(plan, interval),
    recurring: { interval },
    product_data: {
      name: `DaleControl ${plan.name} — Suscripción ${interval === "year" ? "anual" : "mensual"}`,
      metadata: { plan: plan.id },
    },
  };
}

/**
 * Intervalo REAL de la suscripción a partir de su item. Default defensivo a
 * mensual: si Stripe no reporta `recurring` preferimos cobrar de menos.
 */
export function subscriptionItemInterval(
  item: { price?: { recurring?: { interval?: string | null } | null } | null } | null | undefined,
): BillingInterval {
  return item?.price?.recurring?.interval === "year" ? "year" : "month";
}

/**
 * Fin del periodo en curso (epoch en segundos). En las versiones nuevas de la
 * API vive en el item, no en la suscripción.
 */
export function subscriptionPeriodEndSeconds(sub: unknown): number | undefined {
  const s = sub as
    | { current_period_end?: number; items?: { data?: Array<{ current_period_end?: number }> } }
    | null
    | undefined;
  return s?.current_period_end ?? s?.items?.data?.[0]?.current_period_end;
}

/**
 * Campos de fecha de renovación a escribir desde un evento de suscripción.
 *
 * Devuelve `{}` (no toca la columna) cuando Stripe no reporta el fin de periodo.
 * Antes se escribía `null` y el dato se BORRABA: el panel dejaba de mostrar
 * cuándo se renueva.
 */
export function nextBillingDateFields(sub: unknown): { nextBillingDate?: Date } {
  const periodEnd = subscriptionPeriodEndSeconds(sub);
  return periodEnd ? { nextBillingDate: new Date(periodEnd * 1000) } : {};
}

// ── Preview de la factura de prorrateo ──────────────────────────────────────

export interface ChangePlanPreviewLine {
  description: string;
  /** MXN (no centavos). Negativo = crédito a favor. */
  amount: number;
}

/** Item que se manda a la simulación: mismo item, mismo product, importe destino. */
export function buildPreviewSubscriptionItems(args: {
  itemId: string;
  quantity: number;
  currency: string;
  productId: string;
  interval: BillingInterval;
  targetCents: number;
}) {
  return [
    {
      id: args.itemId,
      quantity: args.quantity,
      price_data: {
        currency: args.currency,
        product: args.productId,
        recurring: { interval: args.interval },
        unit_amount: args.targetCents,
      },
    },
  ];
}

/**
 * ¿La factura simulada es realmente la del prorrateo? Una factura de prorrateo
 * SIEMPRE trae líneas con `proration: true`. Si no hay ninguna, Stripe devolvió
 * otra cosa (p. ej. la del próximo ciclo) y su importe engañaría al cliente.
 */
export function hasProrationLines(rawLines: Array<{ proration?: boolean }>): boolean {
  return rawLines.some((line) => line.proration);
}

/** Traduce las líneas de Stripe a los nombres reales de los planes. */
export function mapPreviewLines(
  rawLines: Array<{ proration?: boolean; amount?: number | null; description?: string | null }>,
  ctx: { currentPlanName: string; targetPlanName: string; daysRemaining: number },
): ChangePlanPreviewLine[] {
  return rawLines.map((line) => {
    const amount = (line.amount ?? 0) / 100;
    if (line.proration) {
      return {
        description:
          amount < 0
            ? `Crédito por el tiempo no usado del plan ${ctx.currentPlanName}`
            : `Plan ${ctx.targetPlanName} por los ${ctx.daysRemaining} día(s) que te quedan`,
        amount,
      };
    }
    return { description: line.description ?? "Concepto", amount };
  });
}

/** Línea de factura tal como la devuelve Stripe (lo que nos importa de ella). */
export interface PreviewLineRaw {
  proration?: boolean;
  amount?: number | null;
  description?: string | null;
  period?: { start?: number | null; end?: number | null } | null;
}

/**
 * ¿La factura simulada trae la RENOVACIÓN del próximo ciclo además del
 * prorrateo?
 *
 * `invoices.createPreview` / `GET /v1/invoices/upcoming` devuelven "la próxima
 * factura", que según el modo puede incluir el periodo COMPLETO del plan nuevo.
 * Si eso pasa, `amount_due` es la suma del prorrateo + la mensualidad/anualidad
 * entera: mostrarlo como "se te cobrará hoy" infla el importe varias veces (un
 * upgrade anual pasaría de ~$5,000 a ~$18,000 en pantalla).
 *
 * Una línea de renovación es una línea SIN prorrateo cuyo periodo arranca en el
 * fin del ciclo actual o después. Los InvoiceItems pendientes (excedentes CFDI)
 * también son líneas sin prorrateo, pero su periodo es el de HOY, así que no se
 * confunden.
 */
export function hasRenewalLine(
  rawLines: PreviewLineRaw[],
  currentPeriodEndSeconds: number | null | undefined,
): boolean {
  if (!currentPeriodEndSeconds) return false;
  // Un minuto de tolerancia: Stripe puede reportar el arranque del ciclo nuevo
  // con segundos de diferencia respecto al fin del actual.
  const threshold = currentPeriodEndSeconds - 60;
  return rawLines.some((line) => !line.proration && (line.period?.start ?? 0) >= threshold);
}

/**
 * Lo que se cobra HOY según la simulación. `amount_due` ya trae el prorrateo +
 * los InvoiceItems pendientes del customer + el saldo a favor. Nunca negativo:
 * un crédito neto no es un cobro.
 *
 * Devuelve `null` cuando la factura simulada incluye la renovación del próximo
 * ciclo: ahí `amount_due` NO es el cobro de hoy y preferimos no mostrar importe
 * (el panel cae a "no disponible") antes que enseñar un número falso.
 */
export function previewAmountDueNow(
  invoice: { amount_due?: number | null; lines?: { data?: PreviewLineRaw[] } | null } | null | undefined,
  currentPeriodEndSeconds?: number | null,
): number | null {
  if (hasRenewalLine(invoice?.lines?.data ?? [], currentPeriodEndSeconds)) return null;
  return Math.max(0, (invoice?.amount_due ?? 0) / 100);
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
