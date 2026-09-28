/**
 * Tests unitarios de module-purchase-core.ts (ws1-t2).
 *
 * Correr con:
 *   npm run test:module-purchase
 *   # o:
 *   npx tsx --test src/lib/marketplace/module-purchase-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildActivateModuleWrite,
  canPurchaseModules,
  canRequestModuleCancellation,
  resolveModuleCheckoutReturnUrls,
  computeAnnualPriceMxn,
  hasActiveAccess,
  resolveModuleDeletion,
  resolveModulePriceMxn,
  resolveModuleSubscriptionSync,
} from "./module-purchase-core";

// ── 1. Precio mensual / anual de Ortodoncia ($129 / $1,316) ────────────
test("Ortodoncia mensual → $129", () => {
  const r = resolveModulePriceMxn({ priceMxnMonthly: 129, priceMxnAnnual: 1316 }, "monthly");
  assert.deepEqual(r, { ok: true, amountMxn: 129, billing: "monthly" });
});

test("Ortodoncia anual → $1,316 (129×12×0.85 = 1315.80 redondeado)", () => {
  const r = resolveModulePriceMxn({ priceMxnMonthly: 129, priceMxnAnnual: 1316 }, "annual");
  assert.deepEqual(r, { ok: true, amountMxn: 1316, billing: "annual" });
});

test("computeAnnualPriceMxn(129, 15) === 1316", () => {
  assert.equal(computeAnnualPriceMxn(129, 15), 1316);
});

test("módulo sin precio anual configurado (null) → anual no disponible, mensual sí", () => {
  const mod = { priceMxnMonthly: 349, priceMxnAnnual: null };
  assert.deepEqual(resolveModulePriceMxn(mod, "monthly"), { ok: true, amountMxn: 349, billing: "monthly" });
  const anual = resolveModulePriceMxn(mod, "annual");
  assert.equal(anual.ok, false);
});

test("módulo sin precio mensual (0) → mensual tampoco disponible", () => {
  const r = resolveModulePriceMxn({ priceMxnMonthly: 0, priceMxnAnnual: null }, "monthly");
  assert.equal(r.ok, false);
});

// ── 2. ¿Ya tiene acceso? (bloquea la compra, admin o pagado) ───────────
test("hasActiveAccess: admin grant vigente hasta 2099 → true", () => {
  const now = new Date("2026-09-28T00:00:00.000Z");
  assert.equal(hasActiveAccess({ status: "active", currentPeriodEnd: new Date("2099-12-31") }, now), true);
});

test("hasActiveAccess: sin ClinicModule → false", () => {
  assert.equal(hasActiveAccess(null, new Date()), false);
});

test("hasActiveAccess: status active pero currentPeriodEnd ya pasó → false", () => {
  const now = new Date("2026-09-28T00:00:00.000Z");
  assert.equal(hasActiveAccess({ status: "active", currentPeriodEnd: new Date("2026-01-01") }, now), false);
});

test("hasActiveAccess: cancelado con fecha futura → false (el status manda)", () => {
  const now = new Date("2026-09-28T00:00:00.000Z");
  assert.equal(hasActiveAccess({ status: "cancelled", currentPeriodEnd: new Date("2099-12-31") }, now), false);
});

// ── 3. Activación desde el webhook (idempotente) ───────────────────────
test("buildActivateModuleWrite: alta con tarjeta, mensual", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  const periodEnd = new Date("2026-10-28T12:00:00.000Z");
  const w = buildActivateModuleWrite({
    billing: "monthly",
    amountMxn: 129,
    paymentMethod: "card",
    stripeSubscriptionId: "sub_123",
    currentPeriodEnd: periodEnd,
    now,
  });
  assert.deepEqual(w, {
    status: "active",
    billingCycle: "monthly",
    activatedAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    cancelledAt: null,
    stripeSubscriptionId: "sub_123",
    paymentMethod: "card",
    pricePaidMxn: 129,
  });
});

test("buildActivateModuleWrite: llamarlo dos veces con el mismo input da EXACTAMENTE el mismo resultado (idempotente)", () => {
  const input = {
    billing: "annual" as const,
    amountMxn: 1316,
    paymentMethod: "spei" as const,
    stripeSubscriptionId: null,
    currentPeriodEnd: new Date("2027-09-28T00:00:00.000Z"),
    now: new Date("2026-09-28T00:00:00.000Z"),
  };
  assert.deepEqual(buildActivateModuleWrite(input), buildActivateModuleWrite(input));
});

// ── 4. Sincronizar desde customer.subscription.updated (renovación) ────
test("resolveModuleSubscriptionSync: active con periodo nuevo → update active + extiende currentPeriodEnd", () => {
  const r = resolveModuleSubscriptionSync({
    clinicModuleExists: true,
    subscriptionStatus: "active",
    periodEndFromStripe: new Date("2026-11-28T00:00:00.000Z"),
  });
  assert.deepEqual(r, { type: "update", status: "active", currentPeriodEnd: new Date("2026-11-28T00:00:00.000Z") });
});

test("resolveModuleSubscriptionSync: trialing también cuenta como acceso concedido", () => {
  const r = resolveModuleSubscriptionSync({
    clinicModuleExists: true,
    subscriptionStatus: "trialing",
    periodEndFromStripe: new Date("2026-11-28T00:00:00.000Z"),
  });
  assert.equal(r.type, "update");
  assert.equal((r as any).status, "active");
});

test("resolveModuleSubscriptionSync: past_due → pausa el acceso, no cancela", () => {
  const r = resolveModuleSubscriptionSync({
    clinicModuleExists: true,
    subscriptionStatus: "past_due",
    periodEndFromStripe: null,
  });
  assert.deepEqual(r, { type: "update", status: "paused", currentPeriodEnd: null });
});

test("resolveModuleSubscriptionSync: canceled → noop (la baja la maneja subscription.deleted)", () => {
  const r = resolveModuleSubscriptionSync({
    clinicModuleExists: true,
    subscriptionStatus: "canceled",
    periodEndFromStripe: null,
  });
  assert.equal(r.type, "noop");
});

test("resolveModuleSubscriptionSync: sin ClinicModule conocido → noop", () => {
  const r = resolveModuleSubscriptionSync({
    clinicModuleExists: false,
    subscriptionStatus: "active",
    periodEndFromStripe: new Date(),
  });
  assert.equal(r.type, "noop");
});

// ── 5. Cancelación ──────────────────────────────────────────────────────
test("canRequestModuleCancellation: admin grant no se puede cancelar desde el panel", () => {
  const r = canRequestModuleCancellation({ paymentMethod: "admin", stripeSubscriptionId: null, status: "active" });
  assert.equal(r.ok, false);
});

test("canRequestModuleCancellation: pagado con SPEI/OXXO (sin suscripción) → error explicativo", () => {
  const r = canRequestModuleCancellation({ paymentMethod: "spei", stripeSubscriptionId: null, status: "active" });
  assert.equal(r.ok, false);
});

test("canRequestModuleCancellation: ya cancelado → error", () => {
  const r = canRequestModuleCancellation({ paymentMethod: "card", stripeSubscriptionId: "sub_1", status: "cancelled" });
  assert.equal(r.ok, false);
});

test("canRequestModuleCancellation: tarjeta activa → ok, devuelve el subscriptionId", () => {
  const r = canRequestModuleCancellation({ paymentMethod: "card", stripeSubscriptionId: "sub_1", status: "active" });
  assert.deepEqual(r, { ok: true, stripeSubscriptionId: "sub_1" });
});

test("canRequestModuleCancellation: sin ClinicModule → error", () => {
  const r = canRequestModuleCancellation(null);
  assert.equal(r.ok, false);
});

test("resolveModuleDeletion: admin grant → noop (Stripe nunca manda subscription.deleted para un admin grant, pero por si acaso)", () => {
  const r = resolveModuleDeletion({ paymentMethod: "admin", stripeSubscriptionId: null, status: "active" });
  assert.deepEqual(r, { type: "noop", reason: "admin_grant_no_lo_cancela_stripe" });
});

test("resolveModuleDeletion: pagado con tarjeta → cancel", () => {
  const r = resolveModuleDeletion({ paymentMethod: "card", stripeSubscriptionId: "sub_1", status: "active" });
  assert.deepEqual(r, { type: "cancel" });
});

test("resolveModuleDeletion: sin ClinicModule → noop", () => {
  const r = resolveModuleDeletion(null);
  assert.equal(r.type, "noop");
});

// ── 6. A dónde vuelve después del checkout (ws1-t3) ─────────────────────
const BASE = "https://panel.ejemplo.mx";

test("vuelta del checkout: desde Marketplace, exactamente las URLs de siempre", () => {
  assert.deepEqual(
    resolveModuleCheckoutReturnUrls({ baseUrl: BASE, moduleKey: "orthodontics", method: "card", origin: "marketplace" }),
    {
      successUrl: `${BASE}/dashboard/marketplace?compra=orthodontics&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${BASE}/dashboard/marketplace`,
    },
  );
  assert.deepEqual(
    resolveModuleCheckoutReturnUrls({ baseUrl: BASE, moduleKey: "orthodontics", method: "spei", origin: "marketplace" }),
    {
      successUrl: `${BASE}/dashboard/marketplace?compra=orthodontics&pendiente=spei`,
      cancelUrl: `${BASE}/dashboard/marketplace`,
    },
  );
});

test("vuelta del checkout: desde la página de contratar, vuelve a esa página", () => {
  assert.deepEqual(
    resolveModuleCheckoutReturnUrls({ baseUrl: BASE, moduleKey: "orthodontics", method: "card", origin: "contratar" }),
    {
      successUrl: `${BASE}/dashboard/contratar/ortodoncia?compra=ok&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${BASE}/dashboard/contratar/ortodoncia?compra=cancelada`,
    },
  );
  assert.equal(
    resolveModuleCheckoutReturnUrls({ baseUrl: BASE, moduleKey: "orthodontics", method: "oxxo", origin: "contratar" }).successUrl,
    `${BASE}/dashboard/contratar/ortodoncia?compra=pendiente&metodo=oxxo`,
  );
});

test("vuelta del checkout: un módulo sin página de contratar vuelve a Marketplace aunque pida otra cosa", () => {
  assert.deepEqual(
    resolveModuleCheckoutReturnUrls({ baseUrl: BASE, moduleKey: "implants", method: "card", origin: "contratar" }),
    {
      successUrl: `${BASE}/dashboard/marketplace?compra=implants&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${BASE}/dashboard/marketplace`,
    },
  );
});

// ── 7. Quién puede comprar (ws1-t3) ─────────────────────────────────────
test("comprar un módulo: solo el dueño o un administrador", () => {
  assert.equal(canPurchaseModules("SUPER_ADMIN"), true);
  assert.equal(canPurchaseModules("ADMIN"), true);
  for (const r of ["DOCTOR", "RECEPTIONIST", "READONLY", "", null, undefined]) {
    assert.equal(canPurchaseModules(r), false, String(r));
  }
});
