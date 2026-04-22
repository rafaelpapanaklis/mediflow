export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import {
  DollarSign, Calendar, Users, TrendingUp, Plus, AlertTriangle, Package, UserCog,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { RevenueAreaChart } from "@/components/dashboard/revenue-area-chart";

export const metadata: Metadata = { title: "Dashboard — MediFlow" };

const STATUS_BADGE: Record<string, { tone: "success" | "warning" | "info" | "neutral" | "danger"; label: string }> = {
  PENDING:     { tone: "warning", label: "Pendiente" },
  CONFIRMED:   { tone: "success", label: "Confirmada" },
  IN_PROGRESS: { tone: "info",    label: "En curso" },
  COMPLETED:   { tone: "neutral", label: "Completada" },
  CANCELLED:   { tone: "danger",  label: "Cancelada" },
  NO_SHOW:     { tone: "danger",  label: "No asistió" },
};

const MONTH_ABBR_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function getKpiData(clinicId: string) {
  return unstable_cache(
    async () => {
      const now        = new Date();
      const firstMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const firstPrev  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastPrev   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

      const [monthAppts, prevAppts, monthPatients, prevPatients,
             monthRevenue, prevRevenue, pendingInvoices, allInventory,
             doctorStats, activeDoctor, paidCount, monthlyRevRaw] = await Promise.all([
        prisma.appointment.count({ where: { clinicId, date: { gte: firstMonth }, status: { not: "CANCELLED" } } }),
        prisma.appointment.count({ where: { clinicId, date: { gte: firstPrev, lte: lastPrev }, status: { not: "CANCELLED" } } }),
        prisma.patient.count({ where: { clinicId, createdAt: { gte: firstMonth } } }),
        prisma.patient.count({ where: { clinicId, createdAt: { gte: firstPrev, lte: lastPrev } } }),
        prisma.invoice.aggregate({ where: { clinicId, status: { in: ["PAID", "PARTIAL"] }, updatedAt: { gte: firstMonth } }, _sum: { paid: true } }),
        prisma.invoice.aggregate({ where: { clinicId, status: { in: ["PAID", "PARTIAL"] }, updatedAt: { gte: firstPrev, lte: lastPrev } }, _sum: { paid: true } }),
        prisma.invoice.aggregate({ where: { clinicId, status: { in: ["PENDING", "PARTIAL"] } }, _sum: { balance: true }, _count: true }),
        prisma.inventoryItem.findMany({
          where: { clinicId }, orderBy: { quantity: "asc" }, take: 10,
          select: { id: true, name: true, quantity: true, minQuantity: true, unit: true, emoji: true },
        }),
        prisma.appointment.groupBy({
          by: ["doctorId"],
          where: { clinicId, date: { gte: firstMonth }, status: { not: "CANCELLED" } },
          _count: { id: true },
        }),
        prisma.user.count({ where: { clinicId, isActive: true, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] } } }),
        prisma.invoice.count({ where: { clinicId, status: { in: ["PAID", "PARTIAL"] }, updatedAt: { gte: firstMonth } } }),
        // 6 meses de ingresos agrupados por mes (date_trunc PG).
        // month puede venir como Date (Node driver) o como string ISO cuando
        // la función se serializa por el cache de Next.js → toleramos ambos.
        prisma.$queryRaw<Array<{ month: Date | string; total: number | string | null }>>`
          SELECT date_trunc('month', "updatedAt") AS month, COALESCE(SUM(paid), 0)::float AS total
          FROM invoices
          WHERE "clinicId" = ${clinicId}
            AND status IN ('PAID','PARTIAL')
            AND "updatedAt" >= ${sixMonthsAgo}
          GROUP BY month
          ORDER BY month ASC
        `.catch(() => [] as Array<{ month: Date | string; total: number | string | null }>),
      ]);

      const doctorIds = doctorStats.map(d => d.doctorId);
      const doctors = doctorIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: doctorIds } },
            select: { id: true, firstName: true, lastName: true, color: true },
          })
        : [];

      return {
        monthAppts, prevAppts, monthPatients, prevPatients,
        monthRevenue, prevRevenue, pendingInvoices, allInventory,
        doctorStats, doctors, activeDoctor, paidCount, monthlyRevRaw,
      };
    },
    [`dashboard-kpi-${clinicId}`],
    { revalidate: 300, tags: [`dashboard-${clinicId}`] },
  )();
}

async function getRealTimeData(clinicId: string) {
  const now      = new Date();
  const today    = new Date(now); today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  const [todayAppts, unconfirmed] = await Promise.all([
    prisma.appointment.findMany({
      where: { clinicId, date: { gte: today, lte: todayEnd } },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        doctor:  { select: { id: true, firstName: true, lastName: true, color: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    prisma.appointment.count({ where: { clinicId, date: { gte: today }, status: "PENDING" } }),
  ]);

  return { todayAppts, unconfirmed };
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;

  const [kpi, realTime] = await Promise.all([
    getKpiData(clinicId),
    getRealTimeData(clinicId),
  ]);

  const {
    monthAppts, prevAppts, monthPatients, prevPatients,
    monthRevenue, prevRevenue, pendingInvoices, allInventory,
    doctorStats, doctors, activeDoctor, paidCount, monthlyRevRaw,
  } = kpi;
  const { todayAppts, unconfirmed } = realTime;

  const doctorMap     = Object.fromEntries(doctors.map(d => [d.id, d]));
  const now           = new Date();
  const currentRev    = monthRevenue._sum.paid ?? 0;
  const prevRev       = prevRevenue._sum.paid ?? 0;
  const revenueChange = prevRev > 0 ? Math.round(((currentRev - prevRev) / prevRev) * 100) : 0;
  const apptChange    = prevAppts > 0 ? Math.round(((monthAppts - prevAppts) / prevAppts) * 100) : 0;
  const patientChange = prevPatients > 0 ? Math.round(((monthPatients - prevPatients) / prevPatients) * 100) : 0;
  const workingDays   = Math.min(now.getDate(), 22);
  const occupancy     = activeDoctor * workingDays * 8 > 0 ? Math.min(100, Math.round((monthAppts / (activeDoctor * workingDays * 8)) * 100)) : 0;
  const avgTicket     = paidCount > 0 ? Math.round(currentRev / paidCount) : 0;
  const lowAlerts     = allInventory.filter(i => i.quantity <= i.minQuantity);
  const pendingBalance = pendingInvoices._sum.balance ?? 0;
  const pendingCount   = typeof pendingInvoices._count === "number" ? pendingInvoices._count : 0;

  // Serie mensual para el chart — rellenamos 6 meses siempre (0 si no hay datos).
  // row.month puede ser Date o string ISO (depende del path de serialización
  // del cache), normalizamos a Date antes de leerlo.
  const revenueByMonth = new Map<string, number>();
  for (const row of monthlyRevRaw) {
    const monthDate = row.month instanceof Date ? row.month : new Date(row.month);
    if (isNaN(monthDate.getTime())) continue;
    const key = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
    revenueByMonth.set(key, Number((Number(row.total ?? 0)).toFixed(2)));
  }
  const chartData: Array<{ label: string; value: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    chartData.push({
      label: MONTH_ABBR_ES[d.getMonth()],
      value: revenueByMonth.get(key) ?? 0,
    });
  }

  const fechaEs = now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28, gap: 24, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Dashboard
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, textTransform: "capitalize" }}>
            Resumen de tu clínica — {fechaEs}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/dashboard/reports">
            <ButtonNew variant="secondary" icon={<Calendar size={14} />}>Este mes</ButtonNew>
          </Link>
          <Link href="/dashboard/appointments?new=1">
            <ButtonNew variant="primary" icon={<Plus size={14} />}>Nueva cita</ButtonNew>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 24 }}>
        <KpiCard
          label={`Ingresos del mes`}
          value={formatCurrency(currentRev)}
          delta={revenueChange !== 0 ? {
            value: `${Math.abs(revenueChange)}%`,
            direction: revenueChange >= 0 ? "up" : "down",
            sub: "vs mes anterior",
          } : undefined}
          icon={DollarSign}
        />
        <KpiCard
          label="Citas del mes"
          value={String(monthAppts)}
          delta={apptChange !== 0 ? {
            value: `${Math.abs(apptChange)}%`,
            direction: apptChange >= 0 ? "up" : "down",
            sub: "vs mes anterior",
          } : undefined}
          icon={Calendar}
        />
        <KpiCard
          label="Pacientes nuevos"
          value={String(monthPatients)}
          delta={patientChange !== 0 ? {
            value: `${Math.abs(patientChange)}%`,
            direction: patientChange >= 0 ? "up" : "down",
            sub: "este mes",
          } : undefined}
          icon={Users}
        />
        <KpiCard
          label="Ocupación"
          value={`${occupancy}%`}
          delta={{ value: `Ticket $${avgTicket.toLocaleString("es-MX")}`, direction: "up", sub: "" }}
          icon={TrendingUp}
        />
      </div>

      {/* Alertas arriba del grid principal (sutiles) */}
      {(unconfirmed > 0 || lowAlerts.length > 0 || pendingCount > 0) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
          {unconfirmed > 0 && (
            <Link href="/dashboard/appointments" style={{ textDecoration: "none" }}>
              <BadgeNew tone="warning" dot>{unconfirmed} sin confirmar</BadgeNew>
            </Link>
          )}
          {lowAlerts.length > 0 && (
            <Link href="/dashboard/inventory" style={{ textDecoration: "none" }}>
              <BadgeNew tone="danger" dot>{lowAlerts.length} insumos bajos</BadgeNew>
            </Link>
          )}
          {pendingCount > 0 && (
            <Link href="/dashboard/billing" style={{ textDecoration: "none" }}>
              <BadgeNew tone="info" dot>{pendingCount} facturas por cobrar · {formatCurrency(pendingBalance)}</BadgeNew>
            </Link>
          )}
        </div>
      )}

      {/* Grid principal: 2/3 (chart) + 1/3 (citas hoy) */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <CardNew title="Ingresos" sub="Últimos 6 meses">
          <RevenueAreaChart data={chartData} />
        </CardNew>

        <CardNew
          title="Próximas citas"
          sub={`Hoy · ${todayAppts.length} en total`}
          noPad
          action={
            <Link href="/dashboard/appointments" style={{ textDecoration: "none" }}>
              <ButtonNew size="sm" variant="ghost">Ver agenda</ButtonNew>
            </Link>
          }
        >
          {todayAppts.length === 0 ? (
            <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              Sin citas hoy
            </div>
          ) : (
            <div>
              {todayAppts.slice(0, 6).map(a => {
                const badge = STATUS_BADGE[a.status] ?? STATUS_BADGE.PENDING;
                return (
                  <Link
                    key={a.id}
                    href={`/dashboard/patients/${a.patientId}`}
                    className="list-row"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <AvatarNew name={`${a.patient.firstName} ${a.patient.lastName}`} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {a.patient.firstName} {a.patient.lastName}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                        {a.startTime} · {a.type}
                      </div>
                    </div>
                    <BadgeNew tone={badge.tone} dot>{badge.label}</BadgeNew>
                  </Link>
                );
              })}
            </div>
          )}
        </CardNew>
      </div>

      {/* Grid secundario: 1/1 Inventario bajo + Doctores */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <CardNew
          title="Inventario bajo"
          sub={lowAlerts.length > 0 ? "Requiere atención" : "Todo en nivel normal"}
          noPad
          action={
            <Link href="/dashboard/inventory" style={{ textDecoration: "none" }}>
              <ButtonNew size="sm" variant="ghost">Ver todo</ButtonNew>
            </Link>
          }
        >
          {lowAlerts.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              ✓ Todos los insumos en nivel normal
            </div>
          ) : (
            <table className="table-new">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Actual</th>
                  <th>Mínimo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lowAlerts.map(item => {
                  const critical = item.quantity === 0;
                  return (
                    <tr key={item.id}>
                      <td>
                        <span style={{ marginRight: 8 }}>{item.emoji}</span>
                        {item.name}
                      </td>
                      <td style={{ color: critical ? "var(--danger)" : "var(--warning)", fontWeight: 600, fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
                        {item.quantity} {item.unit}
                      </td>
                      <td style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", color: "var(--text-3)" }}>
                        {item.minQuantity}
                      </td>
                      <td>
                        {critical ? (
                          <BadgeNew tone="danger" dot>Sin stock</BadgeNew>
                        ) : (
                          <BadgeNew tone="warning" dot>Bajo</BadgeNew>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardNew>

        <CardNew title="Doctores" sub="Citas este mes" noPad>
          {doctorStats.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              Sin citas este mes
            </div>
          ) : (
            <div>
              {[...doctorStats].sort((a, b) => b._count.id - a._count.id).map(d => {
                const doc = doctorMap[d.doctorId];
                if (!doc) return null;
                const pct = monthAppts > 0 ? Math.round((d._count.id / monthAppts) * 100) : 0;
                return (
                  <div key={d.doctorId} className="list-row">
                    <AvatarNew name={`${doc.firstName} ${doc.lastName}`} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
                        {doc.firstName} {doc.lastName}
                      </div>
                      <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginTop: 6, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--brand)", borderRadius: 2 }} />
                      </div>
                    </div>
                    <div style={{ fontFamily: "var(--font-jetbrains-mono, monospace)", fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}>
                      {d._count.id}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardNew>
      </div>

      {/* Stats footer — context minimal para admin */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, marginTop: 16, fontSize: 11, color: "var(--text-3)" }}>
        <span>Doctores activos: <strong style={{ color: "var(--text-2)" }}>{activeDoctor}</strong></span>
        <span>Facturas pagadas (mes): <strong style={{ color: "var(--text-2)" }}>{paidCount}</strong></span>
      </div>
      {/* Suprimir unused icon warnings */}
      <span style={{ display: "none" }}>
        <AlertTriangle /><Package /><UserCog />
      </span>
    </div>
  );
}
