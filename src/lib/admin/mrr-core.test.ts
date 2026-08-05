/**
 * Tests del MRR del panel /admin.
 *
 * Run: npm run test:mrr
 *
 * Qué protege (esto ya se rompió una vez en producción):
 *  - /admin y /admin/payments enseñaban números distintos porque cada uno tenía
 *    su propio cálculo: uno sumaba Clinic.monthlyPrice (columna que Stripe
 *    Checkout nunca escribe → MRR $0 con 5 clínicas activas) y el otro el
 *    precio del plan. Aquí se comprueba que UNA sola función responde a los dos.
 *  - La precedencia: precio negociado > precio de lista del plan.
 *  - Que una clínica en trial NO cuente como MRR.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMrr, isMrrBillable, mrrBreakdownHint, EMPTY_MRR } from "./mrr-core";

// Precios de plan_configs (los que devuelve loadPlanPrices). El orden de las
// claves es el del catálogo y define el orden del desglose.
const PRICES = { BASIC: 419, PRO: 689, CLINIC: 1719 };

const clinic = (
  plan: string | null,
  monthlyPrice: number | null = 0,
  subscriptionStatus: string | null = "active",
) => ({ plan, monthlyPrice, subscriptionStatus });

// ── Precedencia ─────────────────────────────────────────────────────────────

test("sin monthlyPrice vale el precio del plan (el caso de Stripe Checkout)", () => {
  const mrr = computeMrr([clinic("PRO"), clinic("BASIC")], PRICES);
  assert.equal(mrr.total, 689 + 419);
});

test("monthlyPrice > 0 manda sobre el precio de lista (precio negociado)", () => {
  const mrr = computeMrr([clinic("CLINIC", 1200)], PRICES);
  assert.equal(mrr.total, 1200);
  assert.equal(mrr.byPlan[0].negotiated, 1, "se marca como negociada para poder auditarla");
  assert.equal(mrr.byPlan[0].listPrice, 1719, "el desglose sigue enseñando la lista");
});

test("monthlyPrice 0 o null NO deja la clínica en cero: cae al precio del plan", () => {
  assert.equal(computeMrr([clinic("PRO", 0)], PRICES).total, 689);
  assert.equal(computeMrr([clinic("PRO", null)], PRICES).total, 689);
});

test("un plan que no existe en plan_configs vale 0, no un precio inventado", () => {
  const mrr = computeMrr([clinic("LEGACY"), clinic(null)], PRICES);
  assert.equal(mrr.total, 0);
  assert.equal(mrr.clinics, 2, "sigue contando las clínicas aunque no aporten");
});

// ── El bug que motivó todo esto ─────────────────────────────────────────────

test("5 clínicas activas sin monthlyPrice ya NO dan $0", () => {
  const activas = [
    clinic("BASIC"), clinic("BASIC"), clinic("PRO"), clinic("CLINIC"), clinic("CLINIC"),
  ];
  const mrr = computeMrr(activas, PRICES);
  assert.equal(mrr.total, 419 * 2 + 689 + 1719 * 2);
  assert.equal(mrr.total, 4965);
});

test("/admin y /admin/payments dan el MISMO número con las mismas filas", () => {
  const activas = [clinic("BASIC"), clinic("PRO", 900), clinic("CLINIC")];
  // /admin reusa las filas que ya cargó; /admin/payments las consulta aparte.
  // Es la misma función, así que el total no puede divergir.
  const desdeDashboard = computeMrr(activas, PRICES);
  const desdePagos     = computeMrr(activas.slice(), PRICES);
  assert.equal(desdeDashboard.total, desdePagos.total);
  assert.equal(desdeDashboard.total, 419 + 900 + 1719);
});

// ── Qué cuenta como activa ──────────────────────────────────────────────────

test("solo cuenta subscriptionStatus 'active': trialing y paid NO son MRR", () => {
  assert.equal(isMrrBillable({ subscriptionStatus: "active" }), true);
  // "trialing" y "paid" sí abren el panel (ACTIVE_SUBSCRIPTION_STATUSES) pero
  // una clínica en trial paga $0: contarla inflaría el MRR.
  assert.equal(isMrrBillable({ subscriptionStatus: "trialing" }), false);
  assert.equal(isMrrBillable({ subscriptionStatus: "paid" }), false);
  assert.equal(isMrrBillable({ subscriptionStatus: "past_due" }), false);
  assert.equal(isMrrBillable({ subscriptionStatus: null }), false);
});

// ── Desglose auditable ──────────────────────────────────────────────────────

test("el desglose suma exactamente el total y respeta el orden del catálogo", () => {
  const mrr = computeMrr(
    [clinic("CLINIC"), clinic("BASIC"), clinic("PRO"), clinic("BASIC", 500)],
    PRICES,
  );
  assert.deepEqual(mrr.byPlan.map((l) => l.plan), ["BASIC", "PRO", "CLINIC"]);
  assert.equal(mrr.byPlan.reduce((s, l) => s + l.total, 0), mrr.total);
  assert.equal(mrr.byPlan.reduce((s, l) => s + l.clinics, 0), mrr.clinics);
  const basic = mrr.byPlan[0];
  assert.equal(basic.clinics, 2);
  assert.equal(basic.total, 419 + 500);
});

test("sin clínicas activas el MRR es 0 y el desglose lo dice", () => {
  const mrr = computeMrr([], PRICES);
  assert.deepEqual(mrr, EMPTY_MRR);
  assert.equal(mrrBreakdownHint(mrr), "Sin clínicas activas");
});

test("el hint del KPI enseña de dónde sale cada peso", () => {
  const mrr = computeMrr([clinic("BASIC"), clinic("BASIC"), clinic("CLINIC")], PRICES);
  assert.equal(mrrBreakdownHint(mrr), "2 BASIC · 1 CLINIC");
});
