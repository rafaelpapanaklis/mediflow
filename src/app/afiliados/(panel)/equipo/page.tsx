export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { prisma } from "@/lib/prisma";
import { currentParentLevelPct } from "@/lib/affiliates/team";
import { getSellerStatsForAffiliate, emptySellerStat } from "@/lib/affiliates/seller-stats";
import { CardNew } from "@/components/ui/design-system/card-new";
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
      {/* Hero */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -40,
            left: -30,
            width: 280,
            height: 180,
            pointerEvents: "none",
            background: "radial-gradient(60% 70% at 20% 30%, rgba(124,58,237,0.18), transparent 70%)",
          }}
        />
        <div
          style={{
            position: "relative",
            width: 44,
            height: 44,
            borderRadius: 14,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            color: "#fff",
            background: "linear-gradient(135deg, var(--violet-400), var(--brand))",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <Users size={22} />
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Mi equipo
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Registra a tus vendedores y asigna a cada uno su porcentaje de comisión.
          </p>
        </div>
      </div>

      {/* Explicación del split */}
      <CardNew>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--violet-400), var(--brand))",
          }}
        />
        <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: 0, lineHeight: 1.6 }}>
          Tu comisión de nivel ({cap}%) se reparte con tu equipo: asignas a cada vendedor su %, y tú te quedas
          el resto como override. La plataforma no cobra de más.
        </p>
      </CardNew>

      {/* Aviso si el módulo aún no está activado en la BD */}
      {tableMissing && (
        <CardNew>
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            El módulo de equipo aún no está activado. En cuanto se aplique la configuración pendiente podrás
            registrar a tus vendedores aquí.
          </p>
        </CardNew>
      )}

      <TeamManager initial={sellers} levelPct={cap} />
    </div>
  );
}
