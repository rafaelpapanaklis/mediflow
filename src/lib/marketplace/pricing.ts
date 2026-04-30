/**
 * Cálculos de precios del Marketplace (Sprint 2).
 *
 * Reglas (BRIEF.md sección 1.4):
 *   1. Subtotal = suma de precios × meses
 *   2. Restar bonificación anual (si aplica) — anual cobra 10 meses por 12
 *   3. Restar descuento por volumen (sobre subtotal post-anual)
 *   4. Aplicar IVA 16% sobre el resultado
 *   5. Total = subtotal − bonificación − descuento + IVA
 *
 * Descuentos por volumen:
 *   3+ módulos → 10%   ·   5+ → 15%   ·   10+ → 25%
 */

export interface DiscountTier {
  /** Porcentaje del descuento (10, 15 o 25). */
  discount: number;
  /** Mínimo de módulos para alcanzar el tier. */
  count: number;
  /** Etiqueta legible para UI. */
  label: string;
}

export interface CartTotals {
  /** Subtotal previo a bonificación y descuentos (precio × meses). */
  subtotal: number;
  /** Suma simple de precios mensuales (1 mes). */
  subtotalMonthly: number;
  /** Bonificación anual: 2 × subtotalMonthly cuando billingCycle='annual'. */
  annualBonus: number;
  /** Descuento por volumen en MXN, redondeado. */
  discount: number;
  /** IVA 16% redondeado, aplicado sobre subtotal − bonus − discount. */
  tax: number;
  /** Total final: (subtotal − bonus − discount) + tax. */
  final: number;
}

export type BillingCycle = "monthly" | "annual";

/**
 * Devuelve el tier de descuento alcanzado por la cantidad de módulos.
 * null si está por debajo de 3.
 */
export function getDiscountTier(count: number): DiscountTier | null {
  if (count >= 10) return { discount: 25, count: 10, label: "10+ módulos" };
  if (count >= 5)  return { discount: 15, count: 5,  label: "5+ módulos" };
  if (count >= 3)  return { discount: 10, count: 3,  label: "3+ módulos" };
  return null;
}

/**
 * Calcula los totales del carrito. Devuelve enteros (MXN no maneja
 * decimales en CFDI 4.0).
 *
 * @param prices — array de precios mensuales por módulo, en MXN
 * @param billingCycle — 'monthly' o 'annual'
 */
export function calculateTotal(
  prices: number[],
  billingCycle: BillingCycle,
): CartTotals {
  const subtotalMonthly = prices.reduce((sum, p) => sum + p, 0);

  // Anual: cobramos 12 meses, bonificamos 2 → cobro real = 10 meses.
  const subtotal    = billingCycle === "annual" ? subtotalMonthly * 12 : subtotalMonthly;
  const annualBonus = billingCycle === "annual" ? subtotalMonthly * 2  : 0;

  const tier             = getDiscountTier(prices.length);
  const baseAfterAnnual  = subtotal - annualBonus;
  const discount         = tier ? Math.round(baseAfterAnnual * (tier.discount / 100)) : 0;
  const afterDiscount    = baseAfterAnnual - discount;

  // IVA aplica UNA vez al final, sobre el monto ya descontado.
  const tax   = Math.round(afterDiscount * 0.16);
  const final = afterDiscount + tax;

  return { subtotal, subtotalMonthly, annualBonus, discount, tax, final };
}
