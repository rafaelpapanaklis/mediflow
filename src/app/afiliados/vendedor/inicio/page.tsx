export const dynamic = "force-dynamic";

// Portada del VENDEDOR con el lenguaje visual del panel de afiliados
// (src/app/afiliados/panel.css, namespace `dcafp` + primitivas de
// components/afiliados/ui/panel-ui). Mismo mundo que la portada del afiliado,
// con menos superficie: saludo, sus cifras y el atajo a Herramientas —que es
// donde viven sus enlaces, porque un /socio/<slug> sin campaña se atribuiría
// al afiliado PADRE y no a él.
import { redirect } from "next/navigation";
import Link from "next/link";
import { DollarSign, Megaphone } from "lucide-react";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";
import { getSellerOwnStats } from "@/lib/affiliates/seller-stats";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import {
  Chip,
  EmptyState,
  Eyebrow,
  Footnote,
  GridRow,
  GridTable,
  PageHead,
  PanelCard,
  Stat,
  StatRow,
} from "@/components/afiliados/ui/panel-ui";

export default async function VendedorInicioPage() {
  const ctx = await getAffiliateSellerContext();
  if (!ctx) redirect("/afiliados/login");

  const sellerId = ctx.sellerId;
  const seller = ctx.seller;

  // sellerId SIEMPRE de la sesión, nunca del request. Promise.all ≤ 6.
  // recent: comisiones del vendedor (sidecar affiliate_seller_commissions);
  // defensivo por si la tabla nueva aún no existe (degrada a vacío).
  let recent: Awaited<ReturnType<typeof prisma.affiliateSellerCommission.findMany>> = [];
  const [stats] = await Promise.all([
    getSellerOwnStats(sellerId),
    prisma.affiliateSellerCommission
      .findMany({ where: { sellerId }, orderBy: { createdAt: "desc" }, take: 8 })
      .then((rows) => {
        recent = rows;
      })
      .catch(() => {
        recent = [];
      }),
  ]);

  // Nombres de clínica para la tabla (la comisión no tiene relación a Clinic en
  // el schema; resolvemos los nombres en una query aparte, como en inicio).
  const clinicIds = Array.from(new Set(recent.map((c) => c.clinicId)));
  const clinics = clinicIds.length
    ? await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } })
    : [];
  const clinicNameById = new Map(clinics.map((c) => [c.id, c.name]));

  return (
    <>
      <PageHead
        title={`Hola, ${seller.name}`}
        sub={`Ganas el ${seller.commissionPct}% de la comisión de tu afiliado por cada clínica que traes y que se suscribe.`}
      />

      <div className="dcafp-hero">
        {/* Sus cifras. Un vendedor recién dado de alta lo ve todo en cero: las
            cifras van en gris (`idle`) para que se lea "todavía no" y no como
            una pérdida. */}
        <PanelCard>
          <div className="dcafp-cardhead">
            <Eyebrow>Pendiente de pago</Eyebrow>
            <Chip tone="brand" dot sm>
              {seller.commissionPct}% de la comisión
            </Chip>
          </div>
          <div
            className={stats.pendingMxn > 0 ? "dcafp-bignum" : "dcafp-bignum dcafp-bignum--idle"}
            style={{ marginTop: 10, overflowWrap: "anywhere" }}
          >
            {formatCurrency(stats.pendingMxn)}
          </div>
          <div style={{ marginTop: 14 }}>
            <StatRow>
              <Stat
                label="Pagado"
                value={formatCurrency(stats.paidMxn)}
                tone={stats.paidMxn > 0 ? "ok" : "idle"}
              />
              <Stat label="Clínicas" value={stats.clinics} tone={stats.clinics > 0 ? "default" : "idle"} />
              <Stat label="Clics" value={stats.clicks} tone={stats.clicks > 0 ? "default" : "idle"} />
            </StatRow>
          </div>
          <div style={{ marginTop: 12 }}>
            <Footnote>
              Tu comisión se genera cuando la clínica paga su factura y se repite cada mes mientras siga
              activa.
            </Footnote>
          </div>
        </PanelCard>

        {/* El bloque "empieza aquí": los enlaces del vendedor viven en
            Herramientas, así que la portada lleva ahí. */}
        <PanelCard
          accent
          tag="EMPIEZA AQUÍ"
          title="Crea tus links y tu cupón"
          sub="Genera un link por canal y pide tu cupón en Herramientas para empezar a traer clínicas."
        >
          <Link href="/afiliados/vendedor/herramientas" className="dcafp-btn dcafp-btn--primary">
            <Megaphone size={16} aria-hidden />
            Ir a Herramientas
          </Link>
          <div style={{ marginTop: 12 }}>
            <Footnote>
              Comparte siempre un link con campaña o tu cupón: es lo que hace que la clínica cuente como
              tuya.
            </Footnote>
          </div>
        </PanelCard>
      </div>

      <PanelCard flush title="Comisiones recientes">
        {recent.length === 0 ? (
          <div style={{ padding: "8px 22px 22px" }}>
            <EmptyState icon={<DollarSign size={22} />} title="Aún no tienes comisiones">
              Cuando una clínica que traes se suscriba y pague su primera factura, tu comisión aparecerá
              aquí — y se repetirá cada mes mientras siga activa.
            </EmptyState>
          </div>
        ) : (
          <GridTable
            cols="minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) 104px 104px"
            colsSm="minmax(0,1fr) 92px 96px"
            head={
              <>
                <div>Clínica</div>
                <div className="dcafp-col-opt" style={{ textAlign: "right" }}>
                  Factura
                </div>
                <div style={{ textAlign: "right" }}>Tu comisión</div>
                <div>Estado</div>
                <div className="dcafp-col-opt">Fecha</div>
              </>
            }
            foot={
              stats.commissionsCount > recent.length
                ? `Mostrando las ${recent.length} más recientes de ${stats.commissionsCount} comisiones.`
                : undefined
            }
          >
            {recent.map((c) => (
              <GridRow key={c.id}>
                <div className="dcafp-td--name">{clinicNameById.get(c.clinicId) ?? "Clínica"}</div>
                <div className="dcafp-col-opt dcafp-td--num dcafp-td--muted">
                  {formatCurrency(c.amountMxn)}
                </div>
                <div className="dcafp-td--num">{formatCurrency(c.commissionMxn)}</div>
                <div>
                  <Chip tone={c.status === "paid" ? "ok" : "amber"} sm>
                    {c.status === "paid" ? "Pagada" : "Pendiente"}
                  </Chip>
                </div>
                <div className="dcafp-col-opt dcafp-td--muted" style={{ whiteSpace: "nowrap" }}>
                  {formatRelativeDate(c.createdAt)}
                </div>
              </GridRow>
            ))}
          </GridTable>
        )}
      </PanelCard>
    </>
  );
}
