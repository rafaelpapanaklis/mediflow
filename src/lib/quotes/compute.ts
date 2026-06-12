// Cálculo autoritativo de totales y folio del presupuesto. El servidor SIEMPRE
// recalcula: jamás se confía en los totales que mande el cliente.

import type { QuoteItemInput } from "./types";

/** Redondeo a 2 decimales (MXN). Tolera strings/null. */
export function round2(n: unknown): number {
  const v = Number(n);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

export interface NormalizedItem extends QuoteItemInput {
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  phase: number | null;
}

export interface ComputedTotals {
  items: NormalizedItem[];
  subtotal: number;
  discountAmount: number;
  total: number;
}

/**
 * Normaliza cada línea y calcula:
 *   lineTotal = max(0, unitPrice*quantity - discount)
 *   subtotal  = Σ lineTotal
 *   descuento global: si discountPct viene definido manda sobre discountAmount.
 *   total     = max(0, subtotal - discountAmount)
 */
export function computeTotals(
  rawItems: QuoteItemInput[],
  opts: { discountPct?: number | null; discountAmount?: number | null },
): ComputedTotals {
  const items: NormalizedItem[] = (rawItems ?? []).map((it) => {
    const quantity = Math.max(1, Math.floor(Number(it.quantity) || 1));
    const unitPrice = round2(it.unitPrice);
    const discount = round2(Math.max(0, Number(it.discount) || 0));
    const gross = round2(unitPrice * quantity);
    const lineTotal = round2(Math.max(0, gross - discount));
    const phaseNum = it.phase == null ? null : Math.floor(Number(it.phase));
    return {
      ...it,
      quantity,
      unitPrice,
      discount,
      lineTotal,
      phase: phaseNum != null && isFinite(phaseNum) && phaseNum > 0 ? phaseNum : null,
    };
  });

  const subtotal = round2(items.reduce((acc, it) => acc + it.lineTotal, 0));

  let discountAmount = 0;
  const pct = opts.discountPct;
  if (pct != null && isFinite(Number(pct))) {
    const clamped = Math.min(100, Math.max(0, Number(pct)));
    discountAmount = round2((subtotal * clamped) / 100);
  } else if (opts.discountAmount != null && isFinite(Number(opts.discountAmount))) {
    discountAmount = round2(Math.min(subtotal, Math.max(0, Number(opts.discountAmount))));
  }

  const total = round2(Math.max(0, subtotal - discountAmount));
  return { items, subtotal, discountAmount, total };
}

/** Folio legible por clínica: P-0001, P-0042, … */
export function formatFolio(seq: number): string {
  return `P-${String(Math.max(1, Math.floor(seq))).padStart(4, "0")}`;
}

/** Número de fases distintas (>=1) presentes en las líneas — para sesiones del plan. */
export function distinctPhaseCount(items: Array<{ phase?: number | null }>): number {
  const set = new Set<number>();
  (items ?? []).forEach((it) => {
    if (it.phase != null && isFinite(Number(it.phase))) set.add(Number(it.phase));
  });
  return Math.max(1, set.size);
}
