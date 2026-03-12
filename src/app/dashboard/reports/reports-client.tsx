"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, PieChart, Pie, Cell, Legend } from "recharts";
import { formatCurrency } from "@/lib/utils";

const PIE_COLORS = ["#2563eb","#7c3aed","#059669","#d97706","#e11d48","#0891b2"];

interface Props {
  monthlyData: { label: string; revenue: number; patients: number; appointments: number }[];
  topTypes:    { type: string; _count: { id: number } }[];
  byStatus:    { status: string; _count: { id: number } }[];
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente", CONFIRMED: "Confirmada", IN_PROGRESS: "En curso",
  COMPLETED: "Completada", CANCELLED: "Cancelada", NO_SHOW: "No asistió",
};

export function ReportsClient({ monthlyData, topTypes, byStatus }: Props) {
  const pieData = byStatus.map(s => ({ name: STATUS_LABELS[s.status] ?? s.status, value: s._count.id }));
  const totalAppts = byStatus.reduce((s, i) => s + i._count.id, 0);
  const completionRate = totalAppts > 0
    ? Math.round((byStatus.find(s => s.status === "COMPLETED")?._count.id ?? 0) / totalAppts * 100)
    : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-extrabold">Reportes</h1>
        <p className="text-sm text-muted-foreground">Analítica de tu clínica — últimos 6 meses</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Ingresos totales",    value: formatCurrency(monthlyData.reduce((s,m) => s + m.revenue, 0)) },
          { label: "Pacientes nuevos",    value: monthlyData.reduce((s,m) => s + m.patients, 0) },
          { label: "Total citas",         value: totalAppts },
          { label: "Tasa de completadas", value: `${completionRate}%` },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border bg-white p-5 shadow-card">
            <div className="text-2xl font-extrabold mb-0.5">{k.value}</div>
            <div className="text-xs text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="rounded-xl border border-border bg-white p-5 shadow-card mb-5">
        <h2 className="text-sm font-bold mb-4">💰 Ingresos mensuales</h2>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData} barSize={32} margin={{ left: -10 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [formatCurrency(v), "Ingresos"]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} cursor={{ fill: "#f1f5f9" }} />
              <Bar dataKey="revenue" fill="#2563eb" radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        {/* Patient trend */}
        <div className="rounded-xl border border-border bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">👥 Pacientes nuevos / mes</h2>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip formatter={(v: number) => [v, "Pacientes"]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Line type="monotone" dataKey="patients" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 4, fill: "#7c3aed" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Appointment status */}
        <div className="rounded-xl border border-border bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">📅 Estado de citas</h2>
          {pieData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Sin datos aún</div>
          ) : (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="40%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={10} iconType="circle" formatter={(v) => <span style={{ fontSize: 11 }}>{v}</span>} />
                  <Tooltip formatter={(v: number) => [v, "Citas"]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Top appointment types */}
      {topTypes.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">🏥 Tipos de cita más frecuentes</h2>
          <div className="space-y-2.5">
            {topTypes.map((t, i) => {
              const max = topTypes[0]._count.id;
              const pct = Math.round((t._count.id / max) * 100);
              return (
                <div key={t.type} className="flex items-center gap-3">
                  <div className="w-4 text-xs font-bold text-muted-foreground text-right">{i+1}</div>
                  <div className="flex-1">
                    <div className="flex justify-between text-xs font-semibold mb-1">
                      <span>{t.type}</span>
                      <span className="text-muted-foreground">{t._count.id} citas</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
