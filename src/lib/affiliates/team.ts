/**
 * Afiliados — EQUIPOS DE VENDEDORES: contrato del reparto vendedor ↔ padre.
 *
 * La matemática vive en `./team-split.ts` (PURA, client-safe) y se re-exporta
 * aquí para no romper a ningún consumidor: el webhook de Stripe, "Mi equipo" y
 * el panel del vendedor importan de este módulo. El corte es el mismo que
 * payout-core.ts / payout.ts, y existe para que el formulario del afiliado
 * (client component) pueda calcular la equivalencia en pesos con LA MISMA
 * función que escribe el dinero.
 *
 * El % del vendedor es el PORCENTAJE DE LA COMISIÓN DEL PADRE que le toca
 * (0-100), no un % de la factura ni un trozo del nivel — ver team-split.ts.
 */
import { calcCommissionMxn } from "@/lib/affiliates";
import { roundMxn, type CommissionSplit } from "./team-split";

export {
  SELLER_SHARE_MAX,
  clampSellerSharePct,
  computeSellerSplitFromTotal,
  roundMxn,
  type CommissionSplit,
} from "./team-split";

/**
 * Clampa el % de un vendedor al rango [0, cap]. SOLO para el modo histórico
 * "pct" del programa (`computeSellerSplit`, abajo), donde el % del vendedor se
 * aplica a la factura y el tope natural es el % del nivel del padre. El reparto
 * vigente usa `clampSellerSharePct` (tope 100, sin nivel).
 */
export function clampSellerPct(pct: number, cap: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return Math.min(pct, cap);
}

/**
 * HISTÓRICO — modo "pct" del programa: reparte una FACTURA entre vendedor y
 * padre en puntos porcentuales de esa factura. `totalPct` es el % del nivel
 * VIGENTE del padre y el % del vendedor se clampa a él.
 *
 * Ya NO lo llama el webhook: `computeSellerSplitFromTotal` sirve a los dos
 * modos del programa porque el motor entrega la comisión ya resuelta (en modo
 * "pct" ese total es exactamente `amountMxn × nivel%`). Se conserva intacto
 * como referencia del reparto por puntos de factura y con tests propios.
 */
export function computeSellerSplit(
  amountMxn: number,
  totalPct: number,
  frozenSellerPct: number,
): CommissionSplit {
  const totalMxn = calcCommissionMxn(amountMxn, totalPct);
  const sellerPct = clampSellerPct(frozenSellerPct, totalPct);
  const sellerMxn = calcCommissionMxn(amountMxn, sellerPct);
  const overrideMxn = Math.max(0, roundMxn(totalMxn - sellerMxn));
  return {
    totalPct,
    sellerPct,
    overridePct: roundMxn(totalPct - sellerPct),
    totalMxn,
    sellerMxn,
    overrideMxn,
  };
}

// ── Shapes compartidos del equipo (UI afiliado/admin) ────────────────────

export interface SellerRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  commissionPct: number;
  isActive: boolean;
  hasLogin: boolean; // supabaseId != null
  createdAt: string; // ISO
}

/** Métodos de pago válidos del vendedor (mismo catálogo que el afiliado). */
export const SELLER_PAYOUT_METHODS = new Set(["SPEI", "PAYPAL", "OTHER"]);
