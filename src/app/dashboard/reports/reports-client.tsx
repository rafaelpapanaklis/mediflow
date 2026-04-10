"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, PieChart, Pie, Legend } from "recharts";
import { formatCurrency } from "@/lib/utils";

interface Props {
  monthlyData: { label: string; revenue: number; patients: number; appointments: number }[];
  topTypes:    { type: string; _count: { id: number } }[];
  byStatus:    { status: string; _count: { id: number } }[];
}

const STATUS_LABELS: Record<string, string> = { PENDING:"Pendiente", CONFIRMED:"Confirmada", COMPLETED:"Completada", CANCELLED:"Cancelada", NO_SHOW:"No asistió", IN_PROGRESS:"En curso" };
const COLORS = ["#2563eb","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4"];

export function ReportsClient({ monthlyData, topTypes, byStatus }: Props) {
  const totalRevenue = monthlyData.reduce((s, d) => s + d.revenue, 0);
  const totalPatients = monthlyData.reduce((s, d) => s + d.patients, 0);
  const totalAppts = monthlyData.reduce((s, d) => s + d.appointments, 0);
  const completionRate = byStatus.length > 0
    ? Math.round(((byStatus.find(s => s.status === "COMPLETED")?._count.id ?? 0) / byStatus.reduce((s, b) => s + b._count.id, 0)) * 100)
    : 0;
  const pieData = byStatus.map(s => ({ name: STATUS_LABELS[s.status] ?? s.status, value: s._count.id }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold">Reportes y estadísticas</h1>
        <p className="text-sm text-muted-foreground">Últimos 6 meses</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Ingresos totales",  value: formatCurrency(totalRevenue),     icon: "💰", color: "text-emerald-600" },
          { label: "Pacientes nuevos",  value: String(totalPatients),             icon: "👥", color: "text-brand-600"   },
          { label: "Total citas",       value: String(totalAppts),               icon: "📅", color: "text-violet-600"  },
          { label: "Tasa de atención",  value: `${completionRate}%`,             icon: "✅", color: "text-amber-600"   },
        ].map(k => (
          <div key={k.label} className="bg-white dark:bg-slate-900 border border-border rounded-xl p-5 shadow-card">
            <div className="text-2xl mb-2">{k.icon}</div>
            <div className={`text-2xl font-extrabold ${k.color}`}>{k.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white dark:bg-slate-900 border border-border rounded-xl p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">Ingresos mensuales</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} barSize={28} margin={{ left: -20 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={v => v === 0 ? "" : `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => [formatCurrency(v), "Ingresos"]} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="revenue" radius={[6,6,0,0]}>
                  {monthlyData.map((_, i) => <Cell key={i} fill={i === monthlyData.length - 1 ? "#2563eb" : "#bfdbfe"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-border rounded-xl p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">Pacientes y citas</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ left: -20 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="patients" name="Pacientes nuevos" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="appointments" name="Citas" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-border rounded-xl p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">Tipos de consulta más frecuentes</h2>
          {topTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sin datos aún</p>
          ) : (
            <div className="space-y-3">
              {topTypes.map((t, i) => {
                const max = topTypes[0]._count.id;
                const pct = Math.round((t._count.id / max) * 100);
                return (
                  <div key={t.type}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium">{t.type}</span>
                      <span className="text-muted-foreground font-bold">{t._count.id}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-border rounded-xl p-5 shadow-card">
          <h2 className="text-sm font-bold mb-4">Estado de citas</h2>
          {pieData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sin datos aún</p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={3}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white border border-border rounded-xl p-5 shadow-card">
        <h2 className="text-sm font-bold mb-4">Resumen mensual</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Mes","Ingresos","Pacientes nuevos","Citas"].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-bold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...monthlyData].reverse().map(row => (
              <tr key={row.label} className="border-b border-border/60 hover:bg-muted/20">
                <td className="px-4 py-3 font-semibold capitalize">{row.label}</td>
                <td className="px-4 py-3 font-mono font-bold text-emerald-600">{formatCurrency(row.revenue)}</td>
                <td className="px-4 py-3">{row.patients}</td>
                <td className="px-4 py-3">{row.appointments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
