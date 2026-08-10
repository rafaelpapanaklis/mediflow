export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { prisma } from "@/lib/prisma";
import { getPublicOffer } from "@/lib/affiliates/public-offer";
import { effectiveAffiliateMode } from "@/lib/affiliates/payout";
import { getSellerStatsForAffiliate, emptySellerStat } from "@/lib/affiliates/seller-stats";
import { PageHead, Note } from "@/components/afiliados/ui/panel-ui";
import {
  TeamManager,
  type SellerRowWithStats,
  type SplitPlan,
} from "@/components/afiliados/team-manager";

export default async function MiEquipoPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const affiliateId = ctx.affiliateId;

  // Montos REALES del programa para la equivalencia en pesos del formulario:
  // ni una cifra escrita a mano (misma fuente que la landing). Va fuera del
  // Promise.all porque nunca lanza (degrada a los defaults del motor).
  const offer = await getPublicOffer();
  // La comisión del padre por clínica depende de SU modalidad congelada: fijo
  // recurrente (cada mes) o pago único. En modo "pct" del programa no hay monto
  // fijo que enseñar → la equivalencia se explica sobre "cada $100 de comisión".
  const payoutMode = effectiveAffiliateMode(ctx.affiliate.payoutMode, offer.cfg);
  const fixedMode = offer.cfg.defaultMode === "fixed";
  const plans: SplitPlan[] = fixedMode
    ? offer.plans
        .map((p) => ({
          label: p.label,
          commissionMxn: payoutMode === "onetime" ? p.oneTimeMxn : p.recurringMxn,
        }))
        .filter((p) => p.commissionMxn > 0)
    : [];

  // Carga vendedores + stats. Si la tabla affiliate_sellers no existe aún
  // (SQL sin correr), degrada a lista vacía con aviso. Promise.all ≤ 6.
  let sellers: SellerRowWithStats[] = [];
  let tableMissing = false;
  try {
    const [rows, stats] = await Promise.all([
      prisma.affiliateSeller.findMany({
        where: { affiliateId },
        orderBy: { createdAt: "asc" },
      }),
      getSellerStatsForAffiliate(affiliateId),
    ]);
    sellers = rows.map((s) => {
      const st = stats.get(s.id) ?? emptySellerStat(s.id);
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        phone: s.phone,
        commissionPct: s.commissionPct,
        isActive: s.isActive,
        hasLogin: !!s.supabaseId,
        createdAt: s.createdAt.toISOString(),
        clicks: st.clicks,
        clinics: st.clinics,
        pendingMxn: st.pendingMxn,
        paidMxn: st.paidMxn,
      };
    });
  } catch (err: any) {
    if (err?.code === "P2021") {
      tableMissing = true;
    } else {
      throw err;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <PageHead
        title="Mi equipo"
        sub="Registra a tus vendedores y asigna a cada uno qué parte de tu comisión se lleva."
      />

      {/* Qué significa el %. Es un aviso, no un bloque de contenido: va como
          Note y no como tarjeta. */}
      <Note tone="brand">
        El % que le asignas a un vendedor es la parte de TU comisión que se lleva él: con 30 %, de cada
        $100 que te toca por esa clínica él cobra $30 y tú $70. Tu nivel no cambia con esto y la
        plataforma paga lo mismo se reparta como se reparta.
      </Note>

      {/* Aviso si el módulo aún no está activado en la BD */}
      {tableMissing && (
        <Note tone="warn">
          El módulo de equipo aún no está activado. En cuanto se aplique la configuración pendiente podrás
          registrar a tus vendedores aquí.
        </Note>
      )}

      <TeamManager
        initial={sellers}
        plans={plans}
        recurring={payoutMode !== "onetime"}
      />
    </div>
  );
}
