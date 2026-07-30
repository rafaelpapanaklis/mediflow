/**
 * Tests unitarios del prorrateo de cambios de plan.
 *
 * Run: npm run test:proration
 *
 * Foco crítico (este código toca COBRO REAL — Stripe LIVE, sin entorno TEST):
 *  - Una factura fallida de PRORRATEO no debe suspender a la clínica: `past_due`
 *    la saca de ACTIVE_SUBSCRIPTION_STATUSES y le bloquea el panel, así que
 *    intentar SUBIR de plan con una tarjeta que rechaza le costaría el acceso al
 *    plan que ya paga.
 *  - La dirección del cambio (upgrade vs downgrade) decide si el prorrateo se
 *    cobra AHORA (`always_invoice`) o se acredita a la próxima factura
 *    (`create_prorations`). Un signo mal calculado cobra cuando no debe.
 *  - El diferencial manual (SPEI/OXXO) se prorratea por días y nunca es negativo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MANUAL_PERIOD_DAYS,
  MIN_CHARGEABLE_CENTS,
  canSuspendForFailedInvoice,
  changeDirection,
  chargeFailureMessage,
  daysRemainingUntil,
  isLiveSubscriptionStatus,
  isStripeChargeFailure,
  manualUpgradeDiffCents,
  pickPurchasedInterval,
  planAmountCents,
} from "./proration";
import { isClinicBillingAdmin } from "./authz";

// ── invoice.payment_failed → ¿suspender? ────────────────────────────────────

test("canSuspendForFailedInvoice: la renovación y el primer cobro SÍ suspenden", () => {
  assert.equal(canSuspendForFailedInvoice("subscription_cycle"), true);
  assert.equal(canSuspendForFailedInvoice("subscription_create"), true);
});

test("canSuspendForFailedInvoice: un prorrateo rechazado NO suspende", () => {
  // billing_reason del cargo inmediato que genera always_invoice al subir de plan.
  assert.equal(canSuspendForFailedInvoice("subscription_update"), false);
});

test("canSuspendForFailedInvoice: motivos ajenos al ciclo NO suspenden", () => {
  for (const reason of ["manual", "subscription_threshold", "quote_accept", "upcoming", ""]) {
    assert.equal(canSuspendForFailedInvoice(reason), false, `reason=${reason}`);
  }
  assert.equal(canSuspendForFailedInvoice(null), false);
  assert.equal(canSuspendForFailedInvoice(undefined), false);
});

// ── Status vivo de la suscripción ───────────────────────────────────────────

test("isLiveSubscriptionStatus: solo los modificables/cobrables", () => {
  for (const s of ["active", "trialing", "past_due", "unpaid"]) {
    assert.equal(isLiveSubscriptionStatus(s), true, `status=${s}`);
  }
  for (const s of ["canceled", "cancelled", "incomplete", "incomplete_expired", "paused", ""]) {
    assert.equal(isLiveSubscriptionStatus(s), false, `status=${s}`);
  }
  assert.equal(isLiveSubscriptionStatus(null), false);
  assert.equal(isLiveSubscriptionStatus(undefined), false);
});

// ── Dirección e importes ────────────────────────────────────────────────────

const BASIC = { priceMxn: 499, priceMxnAnnual: 3893 };
const PRO = { priceMxn: 999, priceMxnAnnual: 7792 };

test("planAmountCents: respeta el intervalo de la suscripción", () => {
  assert.equal(planAmountCents(PRO, "month"), 99_900);
  assert.equal(planAmountCents(PRO, "year"), 779_200);
});

test("changeDirection: upgrade/downgrade/same por importe del mismo intervalo", () => {
  assert.equal(changeDirection(planAmountCents(BASIC, "month"), planAmountCents(PRO, "month")), "upgrade");
  assert.equal(changeDirection(planAmountCents(PRO, "month"), planAmountCents(BASIC, "month")), "downgrade");
  assert.equal(changeDirection(99_900, 99_900), "same");
  // Anual: el 35% de descuento no invierte la dirección.
  assert.equal(changeDirection(planAmountCents(BASIC, "year"), planAmountCents(PRO, "year")), "upgrade");
});

// ── Días restantes ──────────────────────────────────────────────────────────

test("daysRemainingUntil: redondea hacia arriba y nunca es negativo", () => {
  const now = new Date("2026-07-29T12:00:00.000Z");
  assert.equal(daysRemainingUntil(new Date("2026-08-18T12:00:00.000Z"), now), 20);
  // 19 días y medio → 20 (el día en curso cuenta completo).
  assert.equal(daysRemainingUntil(new Date("2026-08-18T00:00:00.000Z"), now), 20);
  assert.equal(daysRemainingUntil(new Date("2026-07-20T12:00:00.000Z"), now), 0, "periodo vencido");
  assert.equal(daysRemainingUntil(now, now), 0);
  assert.equal(daysRemainingUntil(null, now), 0);
  assert.equal(daysRemainingUntil(undefined, now), 0);
  // Epoch en segundos (formato de Stripe).
  assert.equal(
    daysRemainingUntil(Math.floor(new Date("2026-08-08T12:00:00.000Z").getTime() / 1000), now),
    10,
  );
});

// ── Diferencial manual (SPEI/OXXO ya pagado) ────────────────────────────────

test("manualUpgradeDiffCents: prorratea el delta por los días que quedan", () => {
  const diff = manualUpgradeDiffCents({
    currentCents: planAmountCents(BASIC, "month"),
    targetCents: planAmountCents(PRO, "month"),
    daysRemaining: 20,
    periodDays: MANUAL_PERIOD_DAYS.month,
  });
  // (99900 − 49900) × 20/30 = 33_333.33 → 33_333
  assert.equal(diff, 33_333);
});

test("manualUpgradeDiffCents: sin días restantes no se cobra nada", () => {
  assert.equal(
    manualUpgradeDiffCents({ currentCents: 49_900, targetCents: 99_900, daysRemaining: 0, periodDays: 30 }),
    0,
  );
});

test("manualUpgradeDiffCents: un downgrade nunca devuelve negativo", () => {
  assert.equal(
    manualUpgradeDiffCents({ currentCents: 99_900, targetCents: 49_900, daysRemaining: 20, periodDays: 30 }),
    0,
  );
});

test("manualUpgradeDiffCents: prepago de varios periodos escala proporcional", () => {
  // 60 días restantes de un ciclo mensual = 2× el delta mensual.
  assert.equal(
    manualUpgradeDiffCents({ currentCents: 49_900, targetCents: 99_900, daysRemaining: 60, periodDays: 30 }),
    100_000,
  );
});

test("manualUpgradeDiffCents: anual usa el denominador anual", () => {
  const diff = manualUpgradeDiffCents({
    currentCents: planAmountCents(BASIC, "year"),
    targetCents: planAmountCents(PRO, "year"),
    daysRemaining: 200,
    periodDays: MANUAL_PERIOD_DAYS.year,
  });
  // (779200 − 389300) × 200/365 = 213_643.8 → 213_644
  assert.equal(diff, 213_644);
});

test("MIN_CHARGEABLE_CENTS: un diferencial de centavos no llega a cobro", () => {
  const diff = manualUpgradeDiffCents({
    currentCents: 99_900,
    targetCents: 100_000,
    daysRemaining: 1,
    periodDays: 30,
  });
  assert.ok(diff > 0);
  assert.ok(diff < MIN_CHARGEABLE_CENTS, "debe caer por debajo del mínimo de Stripe");
});

// ── Clasificación de errores de Stripe ──────────────────────────────────────

test("isStripeChargeFailure: tarjeta rechazada = fallo de cobro (402)", () => {
  assert.equal(isStripeChargeFailure({ type: "StripeCardError", code: "card_declined" }), true);
  assert.equal(isStripeChargeFailure({ code: "insufficient_funds" }), true);
  assert.equal(isStripeChargeFailure({ raw: { code: "expired_card" } }), true);
  assert.equal(
    isStripeChargeFailure({ code: "subscription_payment_intent_requires_action" }),
    true,
    "SCA también es fallo de cobro",
  );
  assert.equal(isStripeChargeFailure({ raw: { payment_intent: { id: "pi_1" } } }), true);
});

test("isStripeChargeFailure: un request inválido NO es fallo de cobro", () => {
  assert.equal(isStripeChargeFailure({ type: "StripeInvalidRequestError", code: "parameter_unknown" }), false);
  assert.equal(isStripeChargeFailure({ type: "StripeAPIError" }), false);
  assert.equal(isStripeChargeFailure(null), false);
  assert.equal(isStripeChargeFailure(undefined), false);
});

// ── Ciclo comprado desde la bitácora (regresión del review de PR #117) ──────

/** Fila como la graba /api/billing/checkout (la ÚNICA que registra la compra). */
const purchaseRow = (billing: "monthly" | "annual") => ({
  _created: { before: null, after: { plan: "BASIC", priceMxn: 499, billing, sessionId: "cs_1" } },
});

/** Fila del Checkout del diferencial: MISMO entityType/action, SIN `billing`. */
const diffRow = (interval: "month" | "year") => ({
  _created: {
    before: null,
    after: { event: "self-service-change-plan-manual-diff", plan: "PRO", interval, diffMxn: 333 },
  },
});

test("pickPurchasedInterval: lee el ciclo comprado", () => {
  assert.equal(pickPurchasedInterval([purchaseRow("annual")]), "year");
  assert.equal(pickPurchasedInterval([purchaseRow("monthly")]), "month");
});

test("pickPurchasedInterval: SALTA la fila del diferencial y no la lee como mensual", () => {
  // El caso que sobre-cobraba: la fila más reciente es la del diff (sin
  // `billing`), pero la compra real fue ANUAL. Leerla como "month" prorrateaba
  // sobre 30 días con los díasRestantes de un periodo anual.
  assert.equal(pickPurchasedInterval([diffRow("year"), purchaseRow("annual")]), "year");
  // Varios intentos de upgrade acumulados tampoco tapan la compra.
  assert.equal(
    pickPurchasedInterval([diffRow("year"), diffRow("year"), diffRow("year"), purchaseRow("annual")]),
    "year",
  );
});

test("pickPurchasedInterval: null cuando ninguna fila registra la compra", () => {
  assert.equal(pickPurchasedInterval([]), null);
  assert.equal(pickPurchasedInterval([diffRow("year")]), null);
  assert.equal(pickPurchasedInterval([null, undefined, {}, { _created: {} }]), null);
});

// ── Quién puede cambiar el plan ─────────────────────────────────────────────

test("isClinicBillingAdmin: solo dueño/admin de la clínica", () => {
  assert.equal(isClinicBillingAdmin("SUPER_ADMIN"), true);
  assert.equal(isClinicBillingAdmin("ADMIN"), true);
  // Recepción tiene billing.charge (cobrar a PACIENTES) y aun así no contrata plan.
  for (const role of ["RECEPTIONIST", "DOCTOR", "ASSISTANT", "VIEWER", ""]) {
    assert.equal(isClinicBillingAdmin(role), false, `role=${role}`);
  }
  assert.equal(isClinicBillingAdmin(null), false);
  assert.equal(isClinicBillingAdmin(undefined), false);
});

test("chargeFailureMessage: siempre aclara que el plan NO cambió", () => {
  for (const err of [
    { type: "StripeCardError", code: "card_declined" },
    { code: "insufficient_funds" },
    { code: "expired_card" },
    { code: "incorrect_cvc" },
    { code: "authentication_required" },
    {},
  ]) {
    assert.match(chargeFailureMessage(err), /Tu plan NO cambió/);
  }
});
