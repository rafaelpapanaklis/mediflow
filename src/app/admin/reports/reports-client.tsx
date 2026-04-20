"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Download, Calendar } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { formatCurrency } from "@/lib/utils";

interface ReportData {
  summary: {
    from: string; to: string;
    mrr: number; arr: number; arpu: number; ltv: number;
    churnRate: number; trialConversion: number;
    activeClinics: number; trialClinics: number; totalClinics: number;
    newClinicsPeriod: number; churnedPeriod: number;
    periodRevenue: number; periodPayments: number;
  };
  monthlySeries: { month: string; paid: number; payments: number; newClinics: number; churned: number }[];
  periodInvoices: any[];
}

type Preset = "month" | "quarter" | "year" | "custom";

function firstOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function firstOfYear(d: Date)  { return new Date(d.getFullYear(), 0, 1); }
function firstOfQuarter(d: Date) {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1);
}

export function ReportsClient() {
  const today = new Date();
  const [preset, setPreset] = useState<Preset>("year");
  const [from, setFrom] = useState(firstOfYear(today).toISOString().slice(0, 10));
  const [to, setTo]     = useState(today.toISOString().slice(0, 10));
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, [from, to]);

  function applyPreset(p: Preset) {
    setPreset(p);
    const t = new Date();
    const f = p === "month"   ? firstOfMonth(t)
            : p === "quarter" ? firstOfQuarter(t)
            : p === "year"    ? firstOfYear(t)
            : new Date(from);
    if (p !== "custom") {
      setFrom(f.toISOString().slice(0, 10));
      setTo(t.toISOString().slice(0, 10));
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports?from=${from}&to=${to}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e: any) {
      const msg = e?.message ?? "Error al cargar reporte";
      setError(msg);
      toast.error(msg);
    } finally { setLoading(false); }
  }

  const hasData = data && (
    data.summary.totalClinics > 0 ||
    data.summary.periodPayments > 0 ||
    data.monthlySeries.some(m => m.paid > 0 || m.newClinics > 0 || m.churned > 0)
  );

  function downloadXlsx() {
    window.open(`/api/admin/reports?from=${from}&to=${to}&format=xlsx`, "_blank");
  }

  const chartData = useMemo(() => data?.monthlySeries.map(m => ({ ...m, label: m.month.slice(2) })) ?? [], [data]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Reportes financieros</h1>
          <p className="text-slate-400 text-sm">MRR, ARR, LTV, churn, conversión. Exportable a Excel.</p>
        </div>
        <button
          onClick={downloadXlsx}
          className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 rounded-xl text-sm"
        >
          <Download className="w-4 h-4" />
          Exportar a Excel
        </button>
      </div>

      {/* Periodo */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <Calendar className="w-4 h-4 text-slate-400" />
        <div className="flex gap-1">
          {([
            { k: "month",   l: "Este mes" },
            { k: "quarter", l: "Trimestre" },
            { k: "year",    l: "Este año" },
            { k: "custom",  l: "Custom" },
          ] as { k: Preset; l: string }[]).map(p => (
            <button
              key={p.k}
              onClick={() => applyPreset(p.k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                preset === p.k ? "bg-brand-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {p.l}
            </button>
          ))}
        </div>
        <input type="date" value={from} onChange={e => { setPreset("custom"); setFrom(e.target.value); }} className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-1.5" />
        <span className="text-slate-500 text-xs">→</span>
        <input type="date" value={to}   onChange={e => { setPreset("custom"); setTo(e.target.value); }}   className="bg-slate-800 border border-slate-600 text-white text-sm rounded-lg px-3 py-1.5" />
      </div>

      {loading ? (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-10 text-center text-slate-500 text-sm">Cargando…</div>
      ) : error ? (
        <div className="bg-rose-950/40 border border-rose-700 rounded-2xl p-6 space-y-3">
          <h3 className="text-sm font-bold text-rose-300">No se pudo cargar el reporte</h3>
          <p className="text-xs text-rose-200 font-mono break-all">{error}</p>
          <button onClick={load} className="text-xs font-bold text-brand-400 hover:underline">Reintentar</button>
        </div>
      ) : !data || !hasData ? (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-10 text-center space-y-2">
          <div className="text-4xl">📊</div>
          <h3 className="text-sm font-bold text-white">Sin datos todavía</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Aún no hay clínicas pagando o registros en este periodo. En cuanto registres pagos de suscripción desde /admin/payments, aparecerán aquí las métricas.
          </p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "MRR",             value: formatCurrency(data.summary.mrr),           color: "text-emerald-400" },
              { label: "ARR",             value: formatCurrency(data.summary.arr),           color: "text-brand-400"   },
              { label: "ARPU",            value: formatCurrency(data.summary.arpu),          color: "text-white"       },
              { label: "LTV estimado",    value: formatCurrency(data.summary.ltv),           color: "text-violet-400"  },
              { label: "Churn rate",      value: `${data.summary.churnRate}%`,               color: "text-rose-400"    },
              { label: "Conversión trial", value: `${data.summary.trialConversion}%`,        color: "text-amber-400"   },
              { label: "Ingresos periodo", value: formatCurrency(data.summary.periodRevenue), color: "text-emerald-400" },
              { label: "# pagos periodo", value: data.summary.periodPayments,                color: "text-white"       },
            ].map(k => (
              <div key={k.label} className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
                <div className="text-xs text-slate-400 font-semibold uppercase mb-2">{k.label}</div>
                <div className={`text-2xl font-extrabold ${k.color}`}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Chart: ingresos mensuales */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
            <h3 className="text-sm font-bold mb-3">Ingresos mensuales</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <Bar dataKey="paid" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart: clínicas nuevas vs churn */}
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
            <h3 className="text-sm font-bold mb-3">Nuevas vs churn (mensual)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#64748b" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="newClinics" name="Nuevas"  stroke="#6366f1" strokeWidth={2} />
                  <Line type="monotone" dataKey="churned"    name="Churn"   stroke="#f43f5e" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
