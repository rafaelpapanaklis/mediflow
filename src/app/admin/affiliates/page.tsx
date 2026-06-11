export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { computeLevel, getProgramConfig, levelPct, LEVEL_LABELS } from "@/lib/affiliate-levels";
import { AffiliatesClient } from "./affiliates-client";

export const metadata: Metadata = { title: "Afiliados — Admin DaleControl" };

// Affiliate es global (sin clinicId): el admin ve TODOS los afiliados.
export default async function AdminAffiliatesPage() {
  const [affiliates, config, activeGroups, clickGroups] = await Promise.all([
    prisma.affiliate.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { clinics: true } } },
    }),
    getProgramConfig(),
    prisma.clinic
      .groupBy({
        by: ["affiliateId"],
        where: { affiliateId: { not: null }, subscriptionStatus: "active" },
        _count: { _all: true },
      })
      .catch(() => [] as { affiliateId: string | null; _count: { _all: number } }[]),
    // Clicks totales por afiliado (affiliate_clicks, WS3-T2). catch → tabla
    // sin aplicar = columna en 0, sin romper.
    prisma.affiliateClick
      .groupBy({ by: ["affiliateId"], _count: { _all: true } })
      .catch(() => [] as { affiliateId: string; _count: { _all: number } }[]),
  ]);

  // % vigente por nivel (lo que realmente paga el webhook). Sin config
  // (sql/afiliados-ventas.sql no aplicado) se queda en modo legacy y el
  // client muestra commissionPct como antes.
  const activeByAffiliate = new Map<string, number>();
  for (const g of activeGroups) {
    if (g.affiliateId) activeByAffiliate.set(g.affiliateId, g._count._all);
  }
  const clicksByAffiliate = new Map<string, number>();
  for (const g of clickGroups) {
    clicksByAffiliate.set(g.affiliateId, g._count._all);
  }
  const rows = affiliates.map(a => {
    const totalClicks = clicksByAffiliate.get(a.id) ?? 0;
    if (!config) return { ...a, effectiveLevelLabel: null, effectivePct: null, totalClicks };
    const level = computeLevel(activeByAffiliate.get(a.id) ?? 0, config);
    return { ...a, effectiveLevelLabel: LEVEL_LABELS[level], effectivePct: levelPct(level, config), totalClicks };
  });

  return <AffiliatesClient initial={rows as any} />;
}
