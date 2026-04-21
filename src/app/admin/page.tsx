export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import {
  DollarSign, TrendingUp, CheckCircle, Building2,
  AlertTriangle, Clock, XCircle, Plus, FileText,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/format";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";

export const metadata: Metadata = { title: "Super Admin — MediFlow" };

const PLAN_PRICES: Record<string, number> = { BASIC: 299, PRO: 499, CLINIC: 799 };

export default async function AdminPage() {
  try {
    return await renderAdminDashboard();
  } catch (err: any) {
    console.error("Admin page error:", err);
    return (
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "48px 24px" }}>
        <CardNew>
          <div style={{ padding: 8 }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: "var(--danger)", margin: 0, marginBottom: 12 }}>
              Error al cargar el panel admin
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 16 }}>
              {err.message ?? "Error desconocido"}
            </p>
            {err.message?.includes("column") || err.message?.includes("relation") ? (
              <div style={{
                background: "var(--bg-elev)",
                border: "1px solid var(--border-soft)",
                borderRadius: 10,
                padding: 16,
                fontSize: 13,
                color: "var(--text-2)",
              }}>
                <p style={{ fontWeight: 600, margin: 0, marginBottom: 6 }}>
                  La base de datos necesita ser migrada.
                </p>
                <p style={{ color: "var(--text-3)", margin: 0 }}>
                  Ve a tu Supabase SQL Editor y ejecuta el archivo{" "}
                  <code className="mono" style={{ color: "#c4b5fd" }}>sql/migration_multi_category.sql</code>
                </p>
              </div>
            ) : null}
          </div>
        </CardNew>
      </div>
    );
  }
}

async function renderAdminDashboard() {
  const now    = new Date();
  const month1 = new Date(now.getFullYear(), now.getMonth(), 1);
  const prev1  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev7  = new Date(now); prev7.setDate(prev7.getDate() - 7);

  const [allClinics, newClinicsMonth, newClinicsPrev, subInvoices] = await Promise.all([
    prisma.clinic.findMany({
      include: {
        users:  { select: { id:true, email:true, firstName:true, lastName:true, lastLogin:true } },
        _count: { select: { patients:true, appointments:true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.clinic.count({ where: { createdAt: { gte: month1 } } }),
    prisma.clinic.count({ where: { createdAt: { gte: prev1, lt: month1 } } }),
    prisma.subscriptionInvoice.findMany({
      where:   { createdAt: { gte: prev1 } },
      include: { clinic: { select: { name:true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const trialClinics   = allClinics.filter(c => c.trialEndsAt && new Date(c.trialEndsAt) > now);
  const expiredClinics = allClinics.filter(c => c.trialEndsAt && new Date(c.trialEndsAt) < now && c.subscriptionStatus !== "active");
  const activeClinics  = allClinics.filter(c => c.subscriptionStatus === "active");
  const churnRisk      = allClinics.filter(c => {
    const last = c.users[0]?.lastLogin;
    return last && new Date(last) < prev7 && c.subscriptionStatus === "active";
  });
  const inactiveTrial  = trialClinics.filter(c => {
    const last = c.users[0]?.lastLogin;
    return !last || new Date(last) < prev7;
  });

  const mrr          = activeClinics.reduce((s,c) => s + (PLAN_PRICES[c.plan] ?? 0), 0);
  const mrrPotential = mrr + trialClinics.reduce((s,c) => s + (PLAN_PRICES[c.plan] ?? 0), 0);
  const paidMonth    = subInvoices.filter(i => i.status==="paid" && i.createdAt>=month1).reduce((s,i)=>s+i.amount,0);
  const pendingPay   = subInvoices.filter(i => i.status==="pending").reduce((s,i)=>s+i.amount,0);
  const growthRate   = newClinicsPrev > 0 ? Math.round(((newClinicsMonth-newClinicsPrev)/newClinicsPrev)*100) : 0;

  const fechaStr = now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Panel Admin
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0, textTransform: "capitalize" }}>
            Resumen de operaciones — {fechaStr}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/admin/payments" style={{ textDecoration: "none" }}>
            <ButtonNew variant="secondary" icon={<Plus size={14} />}>Registrar pago</ButtonNew>
          </Link>
          <Link href="/admin/reports" style={{ textDecoration: "none" }}>
            <ButtonNew variant="primary" icon={<FileText size={14} />}>Reporte completo</ButtonNew>
          </Link>
        </div>
      </div>

      {/* KPI principales */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="MRR Activo" value={formatCurrency(mrr)} icon={DollarSign}
          delta={{ value: `${activeClinics.length} clínicas`, direction: "up" }} />
        <KpiCard label="MRR Potencial" value={formatCurrency(mrrPotential)} icon={TrendingUp}
          delta={{ value: `+${trialClinics.length} en trial`, direction: "up" }} />
        <KpiCard label="Cobrado este mes" value={formatCurrency(paidMonth)} icon={CheckCircle}
          delta={{ value: `${formatCurrency(pendingPay)} pendiente`, direction: "down" }} />
        <KpiCard label="Nuevas clínicas" value={String(newClinicsMonth)} icon={Building2}
          delta={{ value: `${Math.abs(growthRate)}% vs mes anterior`, direction: growthRate >= 0 ? "up" : "down" }} />
      </div>

      {/* Contadores secundarios */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <CardNew>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            Total clínicas
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: "var(--text-1)" }}>{allClinics.length}</div>
        </CardNew>
        <CardNew>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />
            Activas
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: "var(--text-1)" }}>{activeClinics.length}</div>
        </CardNew>
        <CardNew>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--warning)" }} />
            En trial
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: "var(--text-1)" }}>{trialClinics.length}</div>
        </CardNew>
        <CardNew>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)" }} />
            Trial expirado
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: "var(--text-1)" }}>{expiredClinics.length}</div>
        </CardNew>
      </div>

      {/* Alertas críticas */}
      {(churnRisk.length > 0 || inactiveTrial.length > 0 || expiredClinics.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
          <CardNew
            title="Riesgo de churn"
            sub="Activas sin login 7+ días"
            action={<AlertTriangle size={16} style={{ color: "var(--danger)" }} />}
          >
            {churnRisk.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 0" }}>Sin riesgo actual</div>
            ) : (
              <div>
                {churnRisk.slice(0, 5).map(c => (
                  <div key={c.id} className="list-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                    <AvatarNew name={c.name} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {formatRelativeDate(c.users[0]?.lastLogin)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardNew>

          <CardNew
            title="Trial inactivo"
            sub="Nunca usaron la app"
            action={<Clock size={16} style={{ color: "var(--warning)" }} />}
          >
            {inactiveTrial.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 0" }}>Todos activos</div>
            ) : (
              <div>
                {inactiveTrial.slice(0, 5).map(c => (
                  <div key={c.id} className="list-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                    <AvatarNew name={c.name} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {formatRelativeDate(c.users[0]?.lastLogin)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardNew>

          <CardNew
            title="Trial expirado"
            sub="No convirtieron"
            action={<XCircle size={16} style={{ color: "var(--text-3)" }} />}
          >
            {expiredClinics.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 0" }}>Sin expirados</div>
            ) : (
              <div>
                {expiredClinics.slice(0, 5).map(c => (
                  <div key={c.id} className="list-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                    <AvatarNew name={c.name} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.name}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {formatRelativeDate(c.trialEndsAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardNew>
        </div>
      )}

      {/* Últimos pagos */}
      <div style={{ marginBottom: 20 }}>
        <CardNew
          noPad
          title="Últimos pagos"
          action={
            <Link href="/admin/payments" style={{ textDecoration: "none" }}>
              <ButtonNew size="sm" variant="ghost">Ver todos</ButtonNew>
            </Link>
          }
        >
          {subInvoices.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              Sin pagos registrados aún
            </div>
          ) : (
            <table className="table-new">
              <thead>
                <tr>
                  <th>Clínica</th>
                  <th>Monto</th>
                  <th>Método</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {subInvoices.slice(0, 10).map(inv => (
                  <tr key={inv.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <AvatarNew name={inv.clinic.name} size="sm" />
                        <span style={{ color: "var(--text-1)", fontWeight: 500 }}>{inv.clinic.name}</span>
                      </div>
                    </td>
                    <td className="mono" style={{ color: "var(--text-1)", fontWeight: 500 }}>
                      {formatCurrency(inv.amount)}
                    </td>
                    <td style={{ color: "var(--text-3)", textTransform: "capitalize" }}>{inv.method ?? "—"}</td>
                    <td>
                      <BadgeNew tone={inv.status === "paid" ? "success" : inv.status === "failed" ? "danger" : "warning"}>
                        {inv.status === "paid" ? "Pagado" : inv.status === "failed" ? "Fallido" : "Pendiente"}
                      </BadgeNew>
                    </td>
                    <td className="mono" style={{ color: "var(--text-3)" }}>
                      {formatRelativeDate(inv.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardNew>
      </div>

      {/* Últimas clínicas */}
      <CardNew
        noPad
        title="Últimas clínicas registradas"
        action={
          <Link href="/admin/clinics" style={{ textDecoration: "none" }}>
            <ButtonNew size="sm" variant="ghost">Ver todas</ButtonNew>
          </Link>
        }
      >
        <table className="table-new">
          <thead>
            <tr>
              <th>Clínica</th>
              <th>Plan</th>
              <th>Pacientes</th>
              <th>Estado</th>
              <th>Registro</th>
            </tr>
          </thead>
          <tbody>
            {allClinics.slice(0, 10).map(clinic => {
              const isActive  = clinic.subscriptionStatus === "active";
              const isTrial   = clinic.trialEndsAt && new Date(clinic.trialEndsAt) > now;
              const isExpired = clinic.trialEndsAt && new Date(clinic.trialEndsAt) < now && !isActive;
              const trialDays = clinic.trialEndsAt ? Math.ceil((new Date(clinic.trialEndsAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
              return (
                <tr key={clinic.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <AvatarNew name={clinic.name} size="sm" />
                      <div style={{ minWidth: 0 }}>
                        <Link href={`/admin/clinics/${clinic.id}`} style={{ color: "var(--text-1)", fontWeight: 500, textDecoration: "none" }}>
                          {clinic.name}
                        </Link>
                        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{clinic.users[0]?.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <BadgeNew tone={clinic.plan === "CLINIC" ? "brand" : clinic.plan === "PRO" ? "info" : "neutral"}>
                      {clinic.plan}
                    </BadgeNew>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                      {formatCurrency(PLAN_PRICES[clinic.plan] ?? 0)}/mes
                    </div>
                  </td>
                  <td className="mono" style={{ color: "var(--text-2)" }}>{clinic._count.patients}</td>
                  <td>
                    {isActive  && <BadgeNew tone="success" dot>Activa</BadgeNew>}
                    {isTrial   && <BadgeNew tone="warning" dot>Trial {trialDays}d</BadgeNew>}
                    {isExpired && <BadgeNew tone="danger" dot>Expirado</BadgeNew>}
                    {!isActive && !isTrial && !isExpired && <BadgeNew tone="neutral">Sin plan</BadgeNew>}
                  </td>
                  <td className="mono" style={{ color: "var(--text-3)" }}>
                    {formatRelativeDate(clinic.createdAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardNew>
    </div>
  );
}
