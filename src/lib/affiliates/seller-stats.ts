/**
 * Afiliados — estadísticas por VENDEDOR (equipo). Consumido por "Mi equipo"
 * (desglose de todos los vendedores del afiliado) y por el panel del vendedor
 * (sus propios números). Todo agregado: el padre solo ve conteos/montos de su
 * equipo; el vendedor solo lo suyo.
 *
 * Funnel del vendedor: clicks (suma de AffiliateLink.clicks de sus links) →
 * clínicas (AffiliateSellerAttribution) → comisión (AffiliateSellerCommission).
 *
 * Defensivo: si las tablas nuevas (affiliate_seller_*) no existen aún en la BD
 * (SQL sin correr), degrada a cero/vacío SIN romper — igual que el resto del
 * subsistema de afiliados (ver lesson_ortho_schema_drift).
 */
import { prisma } from "@/lib/prisma";

export interface SellerStat {
  sellerId: string;
  clicks: number; // suma de clicks de los links del vendedor
  clinics: number; // clínicas atribuidas al vendedor (AffiliateSellerAttribution)
  pendingMxn: number;
  paidMxn: number;
  totalMxn: number;
  commissionsCount: number;
}

function emptyStat(sellerId: string): SellerStat {
  return {
    sellerId,
    clicks: 0,
    clinics: 0,
    pendingMxn: 0,
    paidMxn: 0,
    totalMxn: 0,
    commissionsCount: 0,
  };
}

/**
 * Desglose por vendedor para "Mi equipo" del afiliado. Devuelve un Map
 * sellerId → SellerStat (vendedores sin actividad no aparecen; el caller
 * rellena con emptySellerStat al pintar la fila). GroupBy agregados.
 */
export async function getSellerStatsForAffiliate(
  affiliateId: string,
): Promise<Map<string, SellerStat>> {
  const out = new Map<string, SellerStat>();
  try {
    const [attrGroups, commGroups, linkGroups] = await Promise.all([
      prisma.affiliateSellerAttribution.groupBy({
        by: ["sellerId"],
        where: { affiliateId },
        _count: { _all: true },
      }),
      prisma.affiliateSellerCommission.groupBy({
        by: ["sellerId", "status"],
        where: { affiliateId },
        _sum: { commissionMxn: true },
        _count: { _all: true },
      }),
      prisma.affiliateLink.groupBy({
        by: ["sellerId"],
        where: { affiliateId, sellerId: { not: null } },
        _sum: { clicks: true },
      }),
    ]);
    for (const g of linkGroups) {
      if (!g.sellerId) continue;
      const s = out.get(g.sellerId) ?? emptyStat(g.sellerId);
      s.clicks = g._sum.clicks ?? 0;
      out.set(g.sellerId, s);
    }
    for (const g of attrGroups) {
      const s = out.get(g.sellerId) ?? emptyStat(g.sellerId);
      s.clinics = g._count._all;
      out.set(g.sellerId, s);
    }
    for (const g of commGroups) {
      const s = out.get(g.sellerId) ?? emptyStat(g.sellerId);
      const sum = g._sum.commissionMxn ?? 0;
      if (g.status === "paid") s.paidMxn += sum;
      else s.pendingMxn += sum;
      s.totalMxn += sum;
      s.commissionsCount += g._count._all;
      out.set(g.sellerId, s);
    }
  } catch {
    // tablas nuevas inexistentes → mapa vacío (degrada sin romper)
  }
  return out;
}

export { emptyStat as emptySellerStat };

export interface SellerOwnStats {
  clicks: number;
  clinics: number;
  pendingMxn: number;
  paidMxn: number;
  totalMxn: number;
  commissionsCount: number;
}

/** Números propios del vendedor (su panel). Nunca lanza. */
export async function getSellerOwnStats(sellerId: string): Promise<SellerOwnStats> {
  const empty: SellerOwnStats = {
    clicks: 0,
    clinics: 0,
    pendingMxn: 0,
    paidMxn: 0,
    totalMxn: 0,
    commissionsCount: 0,
  };
  try {
    const [clinics, byStatus, linkAgg] = await Promise.all([
      prisma.affiliateSellerAttribution.count({ where: { sellerId } }),
      prisma.affiliateSellerCommission.groupBy({
        by: ["status"],
        where: { sellerId },
        _sum: { commissionMxn: true },
        _count: { _all: true },
      }),
      prisma.affiliateLink.aggregate({
        where: { sellerId },
        _sum: { clicks: true },
      }),
    ]);
    const pending = byStatus.find((g) => g.status === "pending")?._sum.commissionMxn ?? 0;
    const paid = byStatus.find((g) => g.status === "paid")?._sum.commissionMxn ?? 0;
    return {
      clicks: linkAgg._sum.clicks ?? 0,
      clinics,
      pendingMxn: pending,
      paidMxn: paid,
      totalMxn: pending + paid,
      commissionsCount: byStatus.reduce((a, g) => a + g._count._all, 0),
    };
  } catch {
    return empty;
  }
}
