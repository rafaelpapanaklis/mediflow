export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { prisma } from "@/lib/prisma";
import { currentParentLevelPct } from "@/lib/affiliates/team";
import { getSellerStatsForAffiliate, emptySellerStat } from "@/lib/affiliates/seller-stats";
import { PageHead, Note } from "@/components/afiliados/ui/panel-ui";
import { TeamManager, type SellerRowWithStats } from "@/components/afiliados/team-manager";

export default async function MiEquipoPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const affiliateId = ctx.affiliateId;

  // cap = % del nivel vigente del padre (nunca lanza; cae a legacy). Va fuera
  // del Promise.all porque tiene sus propios try/catch internos.
  const cap = await currentParentLevelPct(affiliateId, ctx.affiliate.commissionPct);

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
        sub="Registra a tus vendedores y asigna a cada uno su porcentaje de comisión."
      />

      {/* Cómo se reparte la comisión del nivel. Es un aviso, no un bloque de
          contenido: va como Note y no como tarjeta. */}
      <Note tone="brand">
        Tu comisión de nivel ({cap}%) se reparte con tu equipo: asignas a cada vendedor su %, y tú te quedas
        el resto como override. La plataforma no cobra de más.
      </Note>

      {/* Aviso si el módulo aún no está activado en la BD */}
      {tableMissing && (
        <Note tone="warn">
          El módulo de equipo aún no está activado. En cuanto se aplique la configuración pendiente podrás
          registrar a tus vendedores aquí.
        </Note>
      )}

      <TeamManager initial={sellers} levelPct={cap} />
    </div>
  );
}
