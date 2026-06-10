export const dynamic = "force-dynamic";

// Herramientas de venta del afiliado: nivel + multi-links con campaña +
// cupón propio + kit de marketing + plantillas de prospección.
// Server component (prisma directo, patrón del panel). Todas las queries a
// tablas NUEVAS van en try/catch: si sql/afiliados-ventas.sql no se ha
// corrido, la página carga igual con ready=false (aviso, sin 500).
// Privacidad: el afiliado solo ve CONTEOS, nunca datos de las clínicas.

import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { prisma } from "@/lib/prisma";
import { getAffiliateLevelInfo } from "@/lib/affiliate-levels";
import { CardNew } from "@/components/ui/design-system/card-new";
import { LinksManager, type ToolLink } from "@/components/afiliados/tools/links-manager";
import { CouponCard, type AffiliateCouponInfo } from "@/components/afiliados/tools/coupon-card";
import { MarketingKit } from "@/components/afiliados/tools/marketing-kit";
import { ProspectTemplates } from "@/components/afiliados/tools/prospect-templates";
import { LevelProgress } from "@/components/afiliados/level-progress";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mediflow-pi.vercel.app";

export default async function HerramientasPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const affiliateId = ctx.affiliateId;
  const base = SITE_URL.replace(/\/$/, "");
  const slug = ctx.affiliate.slug;
  const partnerUrl = `${base}/socio/${slug}`;

  let ready = true;
  let links: ToolLink[] = [];
  let coupon: AffiliateCouponInfo | null = null;

  // Links + conversiones por campaña (tablas nuevas → defensivo)
  try {
    const [rows, convGroups] = await Promise.all([
      prisma.affiliateLink.findMany({ where: { affiliateId }, orderBy: { createdAt: "asc" } }),
      prisma.affiliateConversion.groupBy({
        by: ["campaign"],
        where: { affiliateId },
        _count: { _all: true },
      }),
    ]);
    const convByCampaign = new Map(convGroups.map((g) => [g.campaign ?? "", g._count._all]));
    links = rows.map((r) => ({
      id: r.id,
      name: r.name,
      campaign: r.campaign,
      clicks: r.clicks,
      conversions: convByCampaign.get(r.campaign) ?? 0,
      url: `${partnerUrl}?c=${r.campaign}`,
    }));
  } catch {
    ready = false;
  }

  // Cupón del afiliado (tabla puente nueva → defensivo)
  try {
    const ac = await prisma.affiliateCoupon.findFirst({ where: { affiliateId } });
    if (ac) {
      const c = await prisma.coupon.findUnique({ where: { id: ac.couponId } });
      if (c) {
        let conversions = 0;
        try {
          conversions = await prisma.affiliateConversion.count({
            where: { affiliateId, source: "coupon" },
          });
        } catch {}
        coupon = {
          code: c.code,
          active: c.active,
          type: c.type,
          value: c.value,
          usedCount: c.usedCount,
          conversions,
        };
      }
    }
  } catch {
    ready = false;
  }

  const levelInfo = await getAffiliateLevelInfo(affiliateId, ctx.affiliate.commissionPct);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div
          style={{
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
          <Megaphone size={22} />
        </div>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Herramientas de venta
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Links por campaña, tu cupón, materiales y plantillas para traer más clínicas.
          </p>
        </div>
      </div>

      {!ready && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid rgba(245,158,11,0.35)",
            background: "rgba(245,158,11,0.08)",
            color: "var(--text-2)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          Estas herramientas se activan en cuanto se aplique <span className="mono">sql/afiliados-ventas.sql</span> en
          la base de datos. Mientras tanto puedes ver el kit de marketing y las plantillas.
        </div>
      )}

      {/* Nivel y comisión */}
      <LevelProgress info={levelInfo} />

      {/* Multi-links con campaña */}
      <CardNew
        title="Tus links por campaña"
        sub="Crea un link por canal (Facebook, WhatsApp, expos...) y descubre cuál te trae más clínicas."
      >
        <LinksManager initialLinks={links} ready={ready} />
      </CardNew>

      {/* Cupón propio */}
      <CardNew
        title="Tu cupón"
        sub="Un código con tu nombre: quien lo canjea al registrarse cuenta como referido tuyo, aunque no use tu link."
      >
        <CouponCard initial={coupon} ready={ready} />
      </CardNew>

      {/* Kit de marketing */}
      <CardNew
        title="Kit de marketing"
        sub="Logo oficial, copys listos para compartir y respuestas a objeciones comunes."
      >
        <MarketingKit partnerUrl={partnerUrl} />
      </CardNew>

      {/* Plantillas de prospección */}
      <CardNew
        title="Plantillas de prospección"
        sub="Mensajes de email y WhatsApp listos para personalizar y enviar a clínicas."
      >
        <ProspectTemplates partnerUrl={partnerUrl} />
      </CardNew>
    </div>
  );
}
