export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { Users, DollarSign, Clock, Wallet, Handshake, Percent } from "lucide-react";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ReferralLinks } from "@/components/afiliados/referral-links";
import { getAffiliateLevelInfo } from "@/lib/affiliate-levels";
import { LevelProgress } from "@/components/afiliados/level-progress";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dalecontrol.com";

export default async function AffiliateHomePage() {
  const ctx = await getAffiliateContext();
  if (!ctx) redirect("/afiliados/login");

  const affiliateId = ctx.affiliateId;

  // affiliateId SIEMPRE de la sesión, nunca del request. Promise.all ≤ 6.
  const [referredClinics, byStatus, recent] = await Promise.all([
    prisma.clinic.count({ where: { affiliateId } }),
    prisma.affiliateCommission.groupBy({
      by: ["status"],
      where: { affiliateId },
      _sum: { commissionMxn: true },
      _count: { _all: true },
    }),
    prisma.affiliateCommission.findMany({
      where: { affiliateId },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const pendingTotal = byStatus.find((g) => g.status === "pending")?._sum.commissionMxn ?? 0;
  const paidTotal = byStatus.find((g) => g.status === "paid")?._sum.commissionMxn ?? 0;
  const accrued = pendingTotal + paidTotal;
  const commissionsCount = byStatus.reduce((acc, g) => acc + g._count._all, 0);

  // Nombres de clínica para la tabla (AffiliateCommission no tiene relación a
  // Clinic en el schema; resolvemos los nombres en una query aparte).
  const clinicIds = Array.from(new Set(recent.map((c) => c.clinicId)));
  const clinics = clinicIds.length
    ? await prisma.clinic.findMany({ where: { id: { in: clinicIds } }, select: { id: true, name: true } })
    : [];
  const clinicNameById = new Map(clinics.map((c) => [c.id, c.name]));

  // Nivel bronce/plata/oro y % vigente (fuera del Promise.all: tiene sus
  // propios try/catch internos y cae a legacy si la tabla de config no existe).
  const levelInfo = await getAffiliateLevelInfo(affiliateId, ctx.affiliate.commissionPct);

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
          <Handshake size={22} />
        </div>
        <div style={{ position: "relative" }}>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Hola, {ctx.affiliate.name}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Comparte tu enlace y gana {levelInfo.pct}% recurrente por cada clínica que se suscriba.
          </p>
        </div>
      </div>

      {/* Nivel y comisión */}
      <LevelProgress info={levelInfo} />

      {/* Enlaces de referido */}
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
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
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
            <Handshake size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" }}>
              Tu enlace de referido
            </div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>
              Código:{" "}
              <span className="mono" style={{ color: "var(--violet-400)", fontWeight: 700 }}>
                {ctx.affiliate.referralCode}
              </span>
            </div>
          </div>
        </div>
        <ReferralLinks siteUrl={SITE_URL} slug={ctx.affiliate.slug} referralCode={ctx.affiliate.referralCode} />
      </CardNew>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
        <KpiCard label="Clínicas referidas" value={String(referredClinics)} icon={Users} />
        <KpiCard label="Comisión acumulada" value={formatCurrency(accrued)} icon={DollarSign} />
        <KpiCard label="Pendiente de pago" value={formatCurrency(pendingTotal)} icon={Clock} />
        <KpiCard label="Pagado" value={formatCurrency(paidTotal)} icon={Wallet} />
        <KpiCard label="Tu comisión" value={`${levelInfo.pct}%`} icon={Percent} />
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
              Cuando una clínica se suscriba con tu enlace y pague su primera factura, tu comisión aparecerá aquí —
              y se repetirá cada mes mientras siga activa.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Factura pagada</th>
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
        {commissionsCount > recent.length && (
          <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-3)", borderTop: "1px solid var(--border-soft)" }}>
            Mostrando las {recent.length} más recientes de {commissionsCount} comisiones.
          </div>
        )}
      </CardNew>
    </div>
  );
}
