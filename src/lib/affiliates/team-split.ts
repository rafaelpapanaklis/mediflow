/**
 * Afiliados — EQUIPOS DE VENDEDORES: matemática PURA del reparto (client-safe).
 *
 * Mismo corte que payout-core.ts / payout.ts: aquí no hay una línea de Prisma,
 * para que el formulario de "Mi equipo" (client component) calcule la
 * equivalencia en pesos con EXACTAMENTE la misma función que usa el webhook de
 * Stripe al escribir el dinero. `./team.ts` (server) re-exporta todo esto.
 *
 * QUÉ SIGNIFICA EL % DEL VENDEDOR (AffiliateSeller.commissionPct y su copia
 * congelada AffiliateSellerAttribution.sellerPct):
 *
 *     es el PORCENTAJE DE LA COMISIÓN DEL PADRE que se lleva el vendedor,
 *     en el rango 0-100.
 *
 * 30 % = de cada $100 de comisión el vendedor cobra $30 y el padre $70. NO es
 * un % de la factura de la clínica, ni un trozo del % del nivel del padre.
 *
 * POR QUÉ (ago 2026): el reparto nació cuando el programa pagaba un % de la
 * factura; ahí el nivel SÍ definía cuánto se cobraba y repartirlo en puntos de
 * nivel tenía sentido. Con montos FIJOS por plan el nivel ya no determina el
 * pago, así que usarlo de denominador dejaba el número sin significado: en
 * Bronce (10 %) asignar "10" le entregaba al vendedor la comisión COMPLETA y
 * al padre $0. Ahora el nivel no entra en el reparto.
 *
 * REGLA DE ORO: la plataforma paga lo mismo se reparta como se reparta.
 *   sellerMxn + overrideMxn === totalMxn   (siempre, al centavo).
 * Por eso el override se calcula por RESTA y el reparto entero se hace en
 * CENTAVOS enteros: en binario 0.01 + 0.06 NO da 0.07, así que sumar pesos en
 * coma flotante no comprueba nada.
 */

export function roundMxn(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** El vendedor nunca puede llevarse más del 100 % de la comisión del padre. */
export const SELLER_SHARE_MAX = 100;

/**
 * Clampa el % de comisión de un vendedor al rango [0, 100]. Es el ÚNICO tope
 * del reparto: el nivel del padre ya no interviene.
 */
export function clampSellerSharePct(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(pct, SELLER_SHARE_MAX);
}

export interface CommissionSplit {
  totalPct: number; // 100 = la comisión completa (modo pct: % del nivel del padre)
  sellerPct: number; // % de la comisión que se lleva el vendedor
  overridePct: number; // % que le queda al padre = totalPct − sellerPct
  totalMxn: number; // comisión total resuelta por el motor
  sellerMxn: number; // porción del vendedor
  overrideMxn: number; // porción (override) del padre = total − vendedor
}

/**
 * Reparte una comisión YA RESUELTA por el motor (el monto fijo del plan, o el
 * % del nivel sobre la factura en modo "pct": en los dos casos
 * `resolved.totalMxn` es la comisión completa del padre) entre el vendedor y
 * el padre:
 *
 *     sellerMxn   = round(totalMxn × sellerPct / 100)
 *     overrideMxn = totalMxn − sellerMxn      (por RESTA: siempre cuadra)
 *
 * Con el Básico ($80 de comisión): 10 % → $8 / $72 · 50 % → $40 / $40 ·
 * 100 % → $80 / $0. El nivel del padre NO participa.
 *
 * Todo en centavos enteros para que la REGLA DE ORO se cumpla por
 * construcción: centavos(seller) + centavos(override) === centavos(total).
 */
export function computeSellerSplitFromTotal(
  totalMxn: number,
  sellerSharePct: number,
): CommissionSplit {
  // Una comisión negativa no existe (el motor nunca la produce); tratarla como
  // 0 evita que el reparto invente dinero por el otro lado.
  const total = Math.max(0, roundMxn(totalMxn));
  const sellerPct = clampSellerSharePct(sellerSharePct);

  const totalCents = Math.round(total * 100);
  // sellerPct ≤ 100 ⇒ sellerCents ≤ totalCents ⇒ el override nunca sale
  // negativo, y no hace falta un Math.max que rompería la suma.
  const sellerCents = Math.round((totalCents * sellerPct) / SELLER_SHARE_MAX);
  const overrideCents = totalCents - sellerCents;

  return {
    totalPct: SELLER_SHARE_MAX,
    sellerPct,
    overridePct: roundMxn(SELLER_SHARE_MAX - sellerPct),
    totalMxn: total,
    sellerMxn: sellerCents / 100,
    overrideMxn: overrideCents / 100,
  };
}
