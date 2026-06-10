/**
 * Afiliados — EQUIPOS DE VENDEDORES: contrato + matemática del split.
 *
 * Este archivo es el CONTRATO de la comisión repartida entre un vendedor y su
 * afiliado padre. Lo consumen el webhook de Stripe (genera el split), "Mi
 * equipo" (valida el % del vendedor) y el panel del vendedor.
 *
 * REGLA DE ORO: la comisión total de una venta del equipo = % del nivel del
 * padre (vigente). El vendedor gana su % CONGELADO al alta (clamp al nivel) y
 * el padre el OVERRIDE (= total − vendedor). La plataforma NUNCA paga de más:
 *   sellerMxn + overrideMxn === totalMxn   (siempre).
 */
import { prisma } from "@/lib/prisma";
import { calcCommissionMxn } from "@/lib/affiliates";
import { getProgramConfig, countActiveReferred, computeLevel, levelPct } from "@/lib/affiliate-levels";

export function roundMxn(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Clampa el % de un vendedor al rango [0, cap]. cap = % del nivel del padre. */
export function clampSellerPct(pct: number, cap: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  if (!Number.isFinite(cap) || cap <= 0) return 0;
  return Math.min(pct, cap);
}

export interface CommissionSplit {
  totalPct: number; // % del nivel del padre (vigente)
  sellerPct: number; // % efectivo del vendedor = clamp(congelado, totalPct)
  overridePct: number; // % del padre = totalPct − sellerPct
  totalMxn: number; // comisión total (amount × totalPct)
  sellerMxn: number; // porción del vendedor
  overrideMxn: number; // porción (override) del padre = total − vendedor
}

/**
 * Reparte una factura entre vendedor y padre. `totalPct` es el % del nivel
 * VIGENTE del padre (lo calcula el webhook). `frozenSellerPct` viene de la
 * atribución (congelado al alta de la clínica → no retroactivo). El override
 * se calcula por resta (no por %) para que la suma cuadre al centavo aunque
 * haya redondeos: overrideMxn = round(totalMxn − sellerMxn).
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

/**
 * % del nivel VIGENTE del afiliado padre (para el cap del vendedor y el split).
 * Cae a `legacyPct` (Affiliate.commissionPct) si la tabla de config no existe.
 * Nunca lanza.
 */
export async function currentParentLevelPct(
  affiliateId: string,
  legacyPct: number,
): Promise<number> {
  try {
    const cfg = await getProgramConfig();
    if (!cfg) return legacyPct;
    const active = await countActiveReferred(affiliateId);
    return levelPct(computeLevel(active, cfg), cfg);
  } catch {
    return legacyPct;
  }
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
