"use client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie, Legend, CartesianGrid,
} from "recharts";
import { DollarSign, Users, Calendar as CalendarIcon, Percent, TrendingUp, TrendingDown, AlertCircle, Stethoscope, Activity, Building2, BarChart3 } from "lucide-react";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { fmtMXN } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";

interface Props {
  monthlyData: { label: string; revenue: number; patients: number; appointments: number }[];
  topTypes:    { type: string; _count: { id: number } }[];
  byStatus:    { status: string; _count: { id: number } }[];
  patientStats: {
    total: number;
    newThisMonth: number;
    newPctDelta: number;
    withDebt: number;
    withDebtAmount: number;
    nextApptsToday: number;
    nextApptsWeek: number;
  };
  clinicStats: {
    activeDoctors: number;
    totalResources: number;
    resourcesByKind: { kind: string; _count: { id: number } }[];
    topResources: { resourceId: string; name: string; kind: string; count: number }[];
  };
}

// id -> translation key; resolved via t() at render time (never at module scope)
const STATUS_LABEL_KEYS: Record<string, string> = {
  PENDING: "analytics.reports.statusPending",
  CONFIRMED: "analytics.reports.statusConfirmed",
  COMPLETED: "analytics.reports.statusCompleted",
  CANCELLED: "analytics.reports.statusCancelled",
  NO_SHOW: "analytics.reports.statusNoShow",
  IN_PROGRESS: "analytics.reports.statusInProgress",
};

const DS_COLORS = ["var(--brand)", "var(--success)", "var(--warning)", "var(--info)", "var(--danger)", "var(--violet-400)"];
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--text-1)",
};
const AXIS_TICK = { fontSize: 11, fill: "var(--text-3)" } as any;

export function ReportsClient({ monthlyData, topTypes, byStatus, patientStats, clinicStats }: Props) {
  const t = useT();
  const totalRevenue  = monthlyData.reduce((s, d) => s + d.revenue, 0);
  const totalPatients = monthlyData.reduce((s, d) => s + d.patients, 0);
  const totalAppts    = monthlyData.reduce((s, d) => s + d.appointments, 0);
  const totalStatus   = byStatus.reduce((s, b) => s + b._count.id, 0);
  const completionRate = totalStatus > 0
    ? Math.round(((byStatus.find(s => s.status === "COMPLETED")?._count.id ?? 0) / totalStatus) * 100)
    : 0;
  const avgTicket = totalAppts > 0 ? totalRevenue / totalAppts : 0;
  const pieData = byStatus.map(s => ({
    name: STATUS_LABEL_KEYS[s.status] ? t(STATUS_LABEL_KEYS[s.status]) : s.status,
    value: s._count.id,
  }));

  return (
    <div style={{ padding: "clamp(14px, 1.6vw, 28px)", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "clamp(18px, 1.5vw, 22px)", letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 700, margin: 0 }}>
          {t("analytics.reports.pageTitle")}
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
          {t("analytics.reports.pageSubtitle")}
        </p>
      </div>

      {/* Resumen actual de la clínica */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <BarChart3 size={16} strokeWidth={1.75} style={{ color: "var(--brand)" }} aria-hidden />
          {t("analytics.reports.currentSummary")}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 14 }}>
          <KpiCard
            hero
            label={t("analytics.reports.kpiTotalPatients")}
            value={patientStats.total.toLocaleString()}
            icon={Users}
            delta={{ value: t("analytics.reports.kpiTotalPatientsDelta", { count: patientStats.newThisMonth }), direction: "up", sub: "" }}
          />
          <KpiCard
            label={t("analytics.reports.kpiNewThisMonth")}
            value={patientStats.newThisMonth.toLocaleString()}
            icon={TrendingUp}
            delta={{
              value: patientStats.newPctDelta !== 0
                ? t("analytics.reports.kpiNewDelta", { pct: `${patientStats.newPctDelta > 0 ? "+" : ""}${patientStats.newPctDelta}` })
                : t("analytics.reports.kpiNoChange"),
              direction: patientStats.newPctDelta < 0 ? "down" : "up",
              sub: "",
            }}
          />
          <KpiCard
            label={t("analytics.reports.kpiWithDebt")}
            value={fmtMXN(patientStats.withDebtAmount)}
            icon={AlertCircle}
            delta={{ value: t("analytics.reports.kpiWithDebtDelta", { count: patientStats.withDebt }), direction: "down", sub: "" }}
          />
          <KpiCard
            label={t("analytics.reports.kpiUpcomingAppts")}
            value={`${patientStats.nextApptsToday} / ${patientStats.nextApptsWeek}`}
            icon={CalendarIcon}
            delta={{ value: t("analytics.reports.kpiUpcomingApptsDelta"), direction: "up", sub: "" }}
          />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <KpiCard
            label={t("analytics.reports.kpiActiveDoctors")}
            value={clinicStats.activeDoctors.toLocaleString()}
            icon={Stethoscope}
          />
          <KpiCard
            label={t("analytics.reports.kpiActiveResources")}
            value={clinicStats.totalResources.toLocaleString()}
            icon={Building2}
            delta={{
              value: t("analytics.reports.kpiActiveResourcesDelta", { count: clinicStats.resourcesByKind.length }),
              direction: "up",
              sub: "",
            }}
          />
          <KpiCard
            label={t("analytics.reports.kpiTopResource")}
            value={clinicStats.topResources[0]?.name ?? "—"}
            icon={Activity}
            delta={{
              value: clinicStats.topResources[0]
                ? t("analytics.reports.kpiTopResourceDelta", { count: clinicStats.topResources[0].count })
                : t("analytics.reports.kpiNoUsage"),
              direction: "up",
              sub: "",
            }}
          />
        </div>
      </div>

      {/* Separator visual */}
      <h2 style={{ marginBottom: 20, marginTop: 24, fontSize: 15, fontWeight: 600, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 }}>
        <TrendingUp size={16} strokeWidth={1.75} style={{ color: "var(--brand)" }} aria-hidden />
        {t("analytics.reports.last6Months")}
      </h2>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard hero label={t("analytics.reports.kpiTotalRevenue")} value={fmtMXN(totalRevenue)}  icon={DollarSign} />
        <KpiCard label={t("analytics.reports.kpiNewPatients")} value={String(totalPatients)} icon={Users} />
        <KpiCard label={t("analytics.reports.kpiTotalAppts")}  value={String(totalAppts)}    icon={CalendarIcon} />
        <KpiCard
          label={t("analytics.reports.kpiAvgTicket")}
          value={fmtMXN(avgTicket)}
          icon={Percent}
          delta={{ value: t("analytics.reports.kpiAvgTicketDelta", { pct: completionRate }), direction: "up", sub: "" }}
        />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 14, marginBottom: 14 }}>
        <CardNew title={t("analytics.reports.chartRevenueTitle")} sub={t("analytics.reports.chartRevenueSub")}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} barSize={28} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} stroke="var(--text-4)" />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} stroke="var(--text-4)"
                  tickFormatter={(v: number) => v === 0 ? "" : v < 1000 ? `$${v}` : `$${Math.round(v / 1000)}k`} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: "var(--brand-softer)" }}
                  formatter={(v: number) => [fmtMXN(v), t("analytics.reports.legendRevenue")]}
                />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                  {monthlyData.map((_, i) => (
                    <Cell key={i} fill="var(--brand)" fillOpacity={i === monthlyData.length - 1 ? 1 : 0.35} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardNew>

        <CardNew title={t("analytics.reports.chartTrendTitle")} sub={t("analytics.reports.chartTrendSub")}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} stroke="var(--text-4)" />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} stroke="var(--text-4)" />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-2)" }} />
                <Line type="monotone" dataKey="patients"     name={t("analytics.reports.legendNewPatients")} stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="appointments" name={t("analytics.reports.legendAppts")}       stroke="var(--brand)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardNew>
      </div>

      {/* Bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 14, marginBottom: 14 }}>
        <CardNew title={t("analytics.reports.consultTypesTitle")} sub={t("analytics.reports.consultTypesSub")} noPad>
          {topTypes.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              {t("analytics.reports.noDataYet")}
            </div>
          ) : (
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              {topTypes.map((item, i) => {
                const max = topTypes[0]._count.id;
                const pct = max > 0 ? Math.round((item._count.id / max) * 100) : 0;
                return (
                  <div key={item.type}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: "var(--text-1)", fontWeight: 500 }}>{item.type}</span>
                      <span className="mono" style={{ color: "var(--text-2)", fontWeight: 600 }}>{item._count.id}</span>
                    </div>
                    <div style={{ height: 4, background: "var(--bg-elev-2)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${pct}%`,
                        background: DS_COLORS[i % DS_COLORS.length],
                        borderRadius: 2, transition: "width .3s",
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardNew>

        <CardNew title={t("analytics.reports.apptStatusTitle")} sub={t("analytics.reports.apptStatusSub")}>
          {pieData.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              {t("analytics.reports.noDataYet")}
            </div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={3}>
                    {pieData.map((_, i) => <Cell key={i} fill={DS_COLORS[i % DS_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-2)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardNew>
      </div>

      {/* Summary table */}
      <CardNew title={t("analytics.reports.monthlySummaryTitle")} sub={t("analytics.reports.monthlySummarySub")} noPad>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table className="table-new">
          <thead>
            <tr>
              <th>{t("analytics.reports.colMonth")}</th>
              <th style={{ textAlign: "right" }}>{t("analytics.reports.colRevenue")}</th>
              <th style={{ textAlign: "right" }}>{t("analytics.reports.colNewPatients")}</th>
              <th style={{ textAlign: "right" }}>{t("analytics.reports.colAppts")}</th>
            </tr>
          </thead>
          <tbody>
            {[...monthlyData].reverse().map(row => (
              <tr key={row.label}>
                <td style={{ textTransform: "capitalize", color: "var(--text-1)", fontWeight: 500 }}>{row.label}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--success)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {fmtMXN(row.revenue)}
                </td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{row.patients}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{row.appointments}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </CardNew>

      {/* Uso de recursos / sillones — ultimos 30 dias */}
      <div style={{ marginTop: 14 }}>
        <CardNew title={t("analytics.reports.resourceUsageTitle")} sub={t("analytics.reports.resourceUsageSub")} noPad>
          {clinicStats.topResources.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              {t("analytics.reports.resourceUsageEmpty")}
            </div>
          ) : (
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              {clinicStats.topResources.map((r, i) => {
                const max = clinicStats.topResources[0].count;
                const pct = max > 0 ? Math.round((r.count / max) * 100) : 0;
                return (
                  <div key={r.resourceId}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: "var(--text-1)", fontWeight: 500 }}>
                        {r.name}
                        <span style={{ color: "var(--text-3)", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                          {r.kind}
                        </span>
                      </span>
                      <span className="mono" style={{ color: "var(--text-2)", fontWeight: 600 }}>
                        {t("analytics.reports.resourceApptCount", { count: r.count })}
                      </span>
                    </div>
                    <div style={{ height: 4, background: "var(--bg-elev-2)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${pct}%`,
                        background: DS_COLORS[i % DS_COLORS.length],
                        borderRadius: 2, transition: "width .3s",
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardNew>
      </div>
    </div>
  );
}
