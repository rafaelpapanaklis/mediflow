export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Users, DollarSign, Clock, Wallet, Handshake, Percent, MousePointerClick, Megaphone } from "lucide-react";
import Link from "next/link";
import { getAffiliateSellerContext } from "@/lib/affiliate-seller-auth";
import { getSellerOwnStats } from "@/lib/affiliates/seller-stats";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BadgeNew } from "@/components/ui/design-system/badge-new";

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
            background: "var(--brand-grad)",
            boxShadow: "0 8px 20px -8px rgba(124,58,237,0.6)",
          }}
        >
          <Handshake size={22} />
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Hola, {seller.name}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Ganas {seller.commissionPct}% por cada clínica que traes y que se suscribe.
          </p>
        </div>
      </div>

      {/* Invita a Herramientas */}
      <CardNew>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "var(--brand-grad)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--brand-soft)",
              border: "1px solid var(--border-brand)",
              color: "var(--violet-400)",
            }}
          >
            <Megaphone size={18} />
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" }}>
              Crea tus links y tu cupón
            </div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2, lineHeight: 1.5 }}>
              Genera un link por canal y pide tu cupón en Herramientas para empezar a traer clínicas.
            </div>
          </div>
          <Link
            href="/afiliados/vendedor/herramientas"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0 16px",
              height: 40,
              flexShrink: 0,
              borderRadius: 10,
              border: "1px solid var(--border-brand)",
              background: "var(--brand-soft)",
              color: "var(--violet-400)",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              transition: "all .15s",
            }}
          >
            <Megaphone size={15} />
            Ir a Herramientas
          </Link>
        </div>
      </CardNew>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
        <KpiCard label="Clics" value={String(stats.clicks)} icon={MousePointerClick} />
        <KpiCard label="Clínicas" value={String(stats.clinics)} icon={Users} />
        <KpiCard label="Pendiente de pago" value={formatCurrency(stats.pendingMxn)} icon={Clock} />
        <KpiCard label="Pagado" value={formatCurrency(stats.paidMxn)} icon={Wallet} />
        <KpiCard label="Tu comisión" value={`${seller.commissionPct}%`} icon={Percent} />
      </div>

      {/* Comisiones recientes */}
      <CardNew noPad title="Comisiones recientes">
        {recent.length === 0 ? (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                display: "grid",
                placeItems: "center",
                background: "var(--brand-soft)",
                border: "1px solid var(--border-brand)",
                color: "var(--violet-400)",
              }}
            >
              <DollarSign size={26} />
            </div>
            <div style={{ color: "var(--text-1)", fontWeight: 600, fontSize: 14 }}>Aún no tienes comisiones</div>
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0, maxWidth: 360, lineHeight: 1.5 }}>
              Cuando una clínica que traes se suscriba y pague su primera factura, tu comisión aparecerá aquí —
              y se repetirá cada mes mientras siga activa.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Factura</th>
                  <th>Tu comisión</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id}>
                    <td style={{ color: "var(--text-1)" }}>{clinicNameById.get(c.clinicId) ?? "Clínica"}</td>
                    <td className="mono" style={{ color: "var(--text-2)" }}>{formatCurrency(c.amountMxn)}</td>
                    <td className="mono" style={{ color: "var(--text-1)", fontWeight: 600 }}>
                      {formatCurrency(c.commissionMxn)}
                    </td>
                    <td>
                      <BadgeNew tone={c.status === "paid" ? "success" : "warning"}>
                        {c.status === "paid" ? "Pagada" : "Pendiente"}
                      </BadgeNew>
                    </td>
                    <td className="mono" style={{ color: "var(--text-3)" }}>{formatRelativeDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {stats.commissionsCount > recent.length && (
          <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-3)", borderTop: "1px solid var(--border-soft)" }}>
            Mostrando las {recent.length} más recientes de {stats.commissionsCount} comisiones.
          </div>
        )}
      </CardNew>
    </div>
  );
}
