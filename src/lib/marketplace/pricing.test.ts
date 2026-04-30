/**
 * Tests unitarios de pricing.ts (Sprint 2).
 *
 * Correr con:
 *   npm run test:marketplace-pricing
 *   # o:
 *   npx tsx --test src/lib/marketplace/pricing.test.ts
 *
 * Reglas verificadas (BRIEF.md sección 1.4):
 *   - Volumen: 3+ → 10%, 5+ → 15%, 10+ → 25%
 *   - Anual: cobra 12 meses con bonificación de 2 (cobro real 10 meses)
 *   - IVA 16% se aplica DESPUÉS de descuentos, una sola vez
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateTotal, getDiscountTier } from "./pricing";

// ── 1. 1 módulo mensual a $329 ──────────────────────────────────────
// subtotalMonthly = 329, subtotal = 329, annualBonus = 0
// tier = null → discount = 0
// afterDiscount = 329, tax = round(329 * 0.16) = round(52.64) = 53
// final = 329 + 53 = 382
test("1 módulo mensual a $329 → subtotal 329, sin descuento, IVA 53, total 382", () => {
  const r = calculateTotal([329], "monthly");
  assert.equal(r.subtotalMonthly, 329);
  assert.equal(r.subtotal,        329);
  assert.equal(r.annualBonus,     0);
  assert.equal(r.discount,        0);
  assert.equal(r.tax,             53);
  assert.equal(r.final,           382);
});

// ── 2. 3 módulos mensual → 10% descuento ────────────────────────────
// 3 módulos a $329, $279, $249 → subtotalMonthly = 857
// subtotal = 857, annualBonus = 0, tier = {discount:10, count:3}
// discount = round(857 * 0.10) = 86 (85.7 redondeado)
// afterDiscount = 771, tax = round(771 * 0.16) = round(123.36) = 123
// final = 771 + 123 = 894
test("3 módulos mensual → 10% descuento aplicado", () => {
  const r = calculateTotal([329, 279, 249], "monthly");
  assert.equal(r.subtotalMonthly, 857);
  assert.equal(r.subtotal,        857);
  assert.equal(r.annualBonus,     0);
  assert.equal(r.discount,        86);
  assert.equal(r.tax,             123);
  assert.equal(r.final,           894);

  const tier = getDiscountTier(3);
  assert.deepEqual(tier, { discount: 10, count: 3, label: "3+ módulos" });
});

// ── 3. 5 módulos anual → bonificación 2 meses + 15% descuento ──────
// 5 × $329 = subtotalMonthly = 1645
// subtotal = 1645 × 12 = 19_740, annualBonus = 1645 × 2 = 3290
// baseAfterAnnual = 19_740 − 3290 = 16_450
// tier = 15%, discount = round(16_450 × 0.15) = 2468 (2467.5 redondea a 2468)
// afterDiscount = 16_450 − 2468 = 13_982
// tax = round(13_982 × 0.16) = round(2237.12) = 2237
// final = 13_982 + 2237 = 16_219
test("5 módulos anual → bonificación 2 meses + 15% descuento", () => {
  const r = calculateTotal([329, 329, 329, 329, 329], "annual");
  assert.equal(r.subtotalMonthly, 1645);
  assert.equal(r.subtotal,        19_740);
  assert.equal(r.annualBonus,     3290);
  assert.equal(r.discount,        2468);
  assert.equal(r.tax,             2237);
  assert.equal(r.final,           16_219);

  const tier = getDiscountTier(5);
  assert.deepEqual(tier, { discount: 15, count: 5, label: "5+ módulos" });
});

// ── 4. 10 módulos anual → bonificación + 25% descuento ─────────────
// 10 × $300 = subtotalMonthly = 3000
// subtotal = 36_000, annualBonus = 6000
// baseAfterAnnual = 30_000
// tier = 25%, discount = round(30_000 × 0.25) = 7500
// afterDiscount = 22_500, tax = round(22_500 × 0.16) = 3600
// final = 22_500 + 3600 = 26_100
test("10 módulos anual → bonificación 2 meses + 25% descuento", () => {
  const prices = Array(10).fill(300);
  const r = calculateTotal(prices, "annual");
  assert.equal(r.subtotalMonthly, 3000);
  assert.equal(r.subtotal,        36_000);
  assert.equal(r.annualBonus,     6000);
  assert.equal(r.discount,        7500);
  assert.equal(r.tax,             3600);
  assert.equal(r.final,           26_100);

  const tier = getDiscountTier(10);
  assert.deepEqual(tier, { discount: 25, count: 10, label: "10+ módulos" });
});

// ── 5. Carrito vacío → todo en 0 ───────────────────────────────────
test("carrito vacío → todos los totales en 0", () => {
  const monthly = calculateTotal([], "monthly");
  assert.equal(monthly.subtotalMonthly, 0);
  assert.equal(monthly.subtotal,        0);
  assert.equal(monthly.annualBonus,     0);
  assert.equal(monthly.discount,        0);
  assert.equal(monthly.tax,             0);
  assert.equal(monthly.final,           0);

  const annual = calculateTotal([], "annual");
  assert.equal(annual.subtotalMonthly, 0);
  assert.equal(annual.subtotal,        0);
  assert.equal(annual.annualBonus,     0);
  assert.equal(annual.discount,        0);
  assert.equal(annual.tax,             0);
  assert.equal(annual.final,           0);

  assert.equal(getDiscountTier(0), null);
  assert.equal(getDiscountTier(2), null);
});
