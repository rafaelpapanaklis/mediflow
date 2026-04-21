"use client";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, PieChart, Pie, Legend, CartesianGrid,
} from "recharts";
import { DollarSign, Users, Calendar as CalendarIcon, Percent } from "lucide-react";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { fmtMXN } from "@/lib/format";

interface Props {
  monthlyData: { label: string; revenue: number; patients: number; appointments: number }[];
  topTypes:    { type: string; _count: { id: number } }[];
  byStatus:    { status: string; _count: { id: number } }[];
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente", CONFIRMED: "Confirmada", COMPLETED: "Completada",
  CANCELLED: "Cancelada", NO_SHOW: "No asistió", IN_PROGRESS: "En curso",
};

const DS_COLORS = ["#7c3aed", "#10b981", "#f59e0b", "#3b82f6", "#ef4444", "#06b6d4"];
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--text-1)",
};
const AXIS_TICK = { fontSize: 10, fill: "var(--text-4)" } as any;

export function ReportsClient({ monthlyData, topTypes, byStatus }: Props) {
  const totalRevenue  = monthlyData.reduce((s, d) => s + d.revenue, 0);
  const totalPatients = monthlyData.reduce((s, d) => s + d.patients, 0);
  const totalAppts    = monthlyData.reduce((s, d) => s + d.appointments, 0);
  const totalStatus   = byStatus.reduce((s, b) => s + b._count.id, 0);
  const completionRate = totalStatus > 0
    ? Math.round(((byStatus.find(s => s.status === "COMPLETED")?._count.id ?? 0) / totalStatus) * 100)
    : 0;
  const avgTicket = totalAppts > 0 ? totalRevenue / totalAppts : 0;
  const pieData = byStatus.map(s => ({ name: STATUS_LABELS[s.status] ?? s.status, value: s._count.id }));

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Reportes y estadísticas
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4 }}>
          Últimos 6 meses · Métricas de ingresos, pacientes y citas
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard label="Ingresos totales" value={fmtMXN(totalRevenue)}  icon={DollarSign} />
        <KpiCard label="Pacientes nuevos" value={String(totalPatients)} icon={Users} />
        <KpiCard label="Total citas"      value={String(totalAppts)}    icon={CalendarIcon} />
        <KpiCard
          label="Ticket promedio"
          value={fmtMXN(avgTicket)}
          icon={Percent}
          delta={{ value: `${completionRate}% atención`, direction: "up", sub: "" }}
        />
      </div>

      {/* Charts row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <CardNew title="Ingresos mensuales" sub="Últimos 6 meses">
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} barSize={28} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} stroke="var(--text-4)" />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} stroke="var(--text-4)"
                  tickFormatter={(v: number) => v === 0 ? "" : v < 1000 ? `$${v}` : `$${Math.round(v / 1000)}k`} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: "rgba(124,58,237,0.08)" }}
                  formatter={(v: number) => [fmtMXN(v), "Ingresos"]}
                />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                  {monthlyData.map((_, i) => (
                    <Cell key={i} fill={i === monthlyData.length - 1 ? "#7c3aed" : "rgba(124,58,237,0.35)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardNew>

        <CardNew title="Pacientes y citas" sub="Tendencia mensual">
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} stroke="var(--text-4)" />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} stroke="var(--text-4)" />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-2)" }} />
                <Line type="monotone" dataKey="patients"     name="Pacientes nuevos" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="appointments" name="Citas"            stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardNew>
      </div>

      {/* Bottom row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        <CardNew title="Tipos de consulta" sub="Más frecuentes" noPad>
          {topTypes.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              Sin datos aún
            </div>
          ) : (
            <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              {topTypes.map((t, i) => {
                const max = topTypes[0]._count.id;
                const pct = max > 0 ? Math.round((t._count.id / max) * 100) : 0;
                return (
                  <div key={t.type}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: "var(--text-1)", fontWeight: 500 }}>{t.type}</span>
                      <span className="mono" style={{ color: "var(--text-2)", fontWeight: 600 }}>{t._count.id}</span>
                    </div>
                    <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
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

        <CardNew title="Estado de citas" sub="Distribución">
          {pieData.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
              Sin datos aún
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
      <CardNew title="Resumen mensual" sub="Ingresos, pacientes, citas" noPad>
        <table className="table-new">
          <thead>
            <tr>
              <th>Mes</th>
              <th style={{ textAlign: "right" }}>Ingresos</th>
              <th style={{ textAlign: "right" }}>Pacientes nuevos</th>
              <th style={{ textAlign: "right" }}>Citas</th>
            </tr>
          </thead>
          <tbody>
            {[...monthlyData].reverse().map(row => (
              <tr key={row.label}>
                <td style={{ textTransform: "capitalize", color: "var(--text-1)", fontWeight: 500 }}>{row.label}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--success)", fontWeight: 600 }}>
                  {fmtMXN(row.revenue)}
                </td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>{row.patients}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>{row.appointments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardNew>
    </div>
  );
}
