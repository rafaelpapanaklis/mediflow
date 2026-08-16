export const dynamic = "force-dynamic";

// Herramientas de venta del afiliado: nivel + multi-links con campaña +
// cupón propio + kit de marketing + plantillas de prospección.
// Server component (prisma directo, patrón del panel). Todas las queries a
// tablas NUEVAS van en try/catch: si sql/afiliados-ventas.sql no se ha
// corrido, la página carga igual con ready=false (aviso, sin 500).
// Privacidad: el afiliado solo ve CONTEOS, nunca datos de las clínicas.

import { redirect } from "next/navigation";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { prisma } from "@/lib/prisma";
import { getAffiliateLevelInfo } from "@/lib/affiliate-levels";
import { PageHead, PanelCard, Note } from "@/components/afiliados/ui/panel-ui";
import { LinksManager, type ToolLink } from "@/components/afiliados/tools/links-manager";
import { CouponCard, type AffiliateCouponInfo } from "@/components/afiliados/tools/coupon-card";
import { MarketingKit } from "@/components/afiliados/tools/marketing-kit";
import { ProspectTemplates } from "@/components/afiliados/tools/prospect-templates";
import { LevelProgress, type LevelAmountRow } from "@/components/afiliados/level-progress";
import { getResolvedPlans } from "@/lib/plans";
import {
  getPayoutConfig,
  effectiveAffiliateMode,
  fixedAmountFor,
  normalizePlanKey,
  type ProgramMode,
} from "@/lib/affiliates/payout";
import { siteBase, affiliateLinkUrl, baseReferralUrl } from "@/lib/affiliates/link-url";

// Lectura defensiva de la columna nueva: si `publicCode` todavía no existe en
// la BD (SQL sin correr) el SELECT revienta. Antes de dar la pantalla por
// muerta (ready=false) reintentamos sin esa columna: los links se siguen
// listando y copiando con su URL histórica. Si falta la TABLA entera el
// segundo intento también falla y sube al catch de siempre.
type LinkRow = {
  id: string;
  name: string;
  campaign: string;
  clicks: number;
  publicCode: string | null;
};

async function findLinkRows(affiliateId: string): Promise<LinkRow[]> {
  try {
    return await prisma.affiliateLink.findMany({
      where: { affiliateId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, campaign: true, clicks: true, publicCode: true },
    });
  } catch {
    const rows = await prisma.affiliateLink.findMany({
      where: { affiliateId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, campaign: true, clicks: true },
    });
    return rows.map((r) => ({ ...r, publicCode: null }));
  }
}

export default async function HerramientasPage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const affiliateId = ctx.affiliateId;
  const slug = ctx.affiliate.slug;
  // La landing de socio sigue siendo el destino que reparten el kit de
  // marketing y las plantillas ({tu_link}); por eso partnerUrl no desaparece.
  const partnerUrl = `${siteBase()}/socio/${slug}`;
  // El link BASE (sin campaña) se arma en el servidor: link-url.ts importa
  // prisma y crypto, así que no puede viajar al componente cliente.
  const baseUrl = baseReferralUrl(ctx.affiliate.referralCode);

  let ready = true;
  let links: ToolLink[] = [];
  let coupon: AffiliateCouponInfo | null = null;

  // Links + conversiones por campaña (tablas nuevas → defensivo).
  // La URL se arma con affiliateLinkUrl(), la MISMA función que usa
  // /api/afiliados/links: antes esta page la escribía a mano y un link recién
  // creado (que venía del POST) podía verse distinto al de al lado.
  try {
    const [rows, convGroups] = await Promise.all([
      findLinkRows(affiliateId),
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
      publicCode: r.publicCode,
      clicks: r.clicks,
      conversions: convByCampaign.get(r.campaign) ?? 0,
      url: affiliateLinkUrl(r, slug),
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

  // Motor de comisiones: la misma tarjeta de nivel que /inicio. Si el programa
  // paga MONTOS FIJOS, aquí tampoco se puede pintar la escalera de porcentajes
  // (sería el mismo número falso en dos pantallas). Labels de plan_configs y
  // montos de la config: nada escrito a mano. payoutCfg = null → todo se queda
  // como estaba (% del nivel).
  const [payoutCfg, plans] = await Promise.all([getPayoutConfig(), getResolvedPlans()]);
  const programMode: ProgramMode = payoutCfg ? payoutCfg.defaultMode : "pct";
  const payoutMode = effectiveAffiliateMode(ctx.affiliate.payoutMode, payoutCfg);
  const amounts: LevelAmountRow[] = payoutCfg
    ? plans.map((p) => ({
        plan: p.id,
        label: p.label,
        recurringMxn: fixedAmountFor(normalizePlanKey(p.id), "recurring", payoutCfg),
        oneTimeMxn: fixedAmountFor(normalizePlanKey(p.id), "onetime", payoutCfg),
      }))
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <PageHead
        title="Herramientas de venta"
        sub="Links por campaña, tu cupón, materiales y plantillas para traer más clínicas."
      />

      {!ready && (
        <Note tone="warn">
          Estas herramientas se activan en cuanto se aplique{" "}
          <span className="dcafp-mono">sql/afiliados-ventas.sql</span> en la base de datos. Mientras
          tanto puedes ver el kit de marketing y las plantillas.
        </Note>
      )}

      {/* Nivel y comisión */}
      <LevelProgress info={levelInfo} mode={programMode} payoutMode={payoutMode} amounts={amounts} />

      {/* Multi-links con campaña */}
      <PanelCard
        title="Tus links por campaña"
        sub="Crea un link por canal (Facebook, WhatsApp, expos...) y descubre cuál te trae más clínicas."
      >
        <LinksManager
          initialLinks={links}
          ready={ready}
          baseUrl={baseUrl}
          referralCode={ctx.affiliate.referralCode}
        />
      </PanelCard>

      {/* Cupón propio */}
      <PanelCard
        title="Tu cupón"
        sub="Un código con tu nombre: quien lo canjea al registrarse cuenta como referido tuyo, aunque no use tu link."
      >
        <CouponCard initial={coupon} ready={ready} />
      </PanelCard>

      {/* Kit de marketing */}
      <PanelCard
        title="Kit de marketing"
        sub="Logo oficial, imágenes para redes y material para imprimir con tu nombre y tu QR, copys listos para compartir y respuestas a objeciones comunes."
      >
        {/* Solo las campañas con link corto: el QR de una pieza impresa no
            puede llevar la URL histórica con querystring. Sin ninguna, el
            material sale con el link base y el selector ni se pinta. */}
        <MarketingKit
          partnerUrl={partnerUrl}
          qrLinks={links.filter((l) => l.publicCode).map((l) => ({ id: l.id, label: l.name }))}
        />
      </PanelCard>

      {/* Plantillas de prospección */}
      <PanelCard
        title="Plantillas de prospección"
        sub="Mensajes de email y WhatsApp listos para personalizar y enviar a clínicas."
      >
        <ProspectTemplates partnerUrl={partnerUrl} />
      </PanelCard>
    </div>
  );
}
