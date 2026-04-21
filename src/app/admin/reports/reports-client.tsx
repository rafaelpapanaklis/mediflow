"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Download, Calendar, TrendingUp, DollarSign, Users, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend } from "recharts";
import { formatCurrency } from "@/lib/utils";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard }   from "@/components/ui/design-system/kpi-card";

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

const TOOLTIP_STYLE = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  color: "var(--text-1)",
  fontSize: 12,
};

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

  const presets: { k: Preset; l: string }[] = [
    { k: "month",   l: "Este mes" },
    { k: "quarter", l: "Trimestre" },
    { k: "year",    l: "Este año" },
    { k: "custom",  l: "Custom" },
  ];

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Reportes financieros
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            MRR, ARR, LTV, churn, conversión. Exportable a Excel.
          </p>
        </div>
        <ButtonNew variant="primary" icon={<Download size={14} />} onClick={downloadXlsx}>
          Exportar a Excel
        </ButtonNew>
      </div>

      {/* Periodo */}
      <CardNew className="mb-16">
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-3)", fontSize: 12 }}>
            <Calendar size={14} />
            <span>Periodo</span>
          </div>
          <div className="segment-new" style={{ display: "inline-flex", gap: 2 }}>
            {presets.map(p => (
              <button
                key={p.k}
                type="button"
                onClick={() => applyPreset(p.k)}
                className={`segment-new__btn ${preset === p.k ? "segment-new__btn--active" : ""}`}
              >
                {p.l}
              </button>
            ))}
          </div>
          <input
            type="date"
            value={from}
            onChange={e => { setPreset("custom"); setFrom(e.target.value); }}
            className="input-new"
            style={{ width: 160 }}
          />
          <span style={{ color: "var(--text-3)", fontSize: 12 }}>→</span>
          <input
            type="date"
            value={to}
            onChange={e => { setPreset("custom"); setTo(e.target.value); }}
            className="input-new"
            style={{ width: 160 }}
          />
        </div>
      </CardNew>

      <div style={{ marginTop: 16 }} />

      {loading ? (
        <CardNew>
          <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            Cargando…
          </div>
        </CardNew>
      ) : error ? (
        <CardNew>
          <div
            style={{
              padding: "18px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)", margin: 0 }}>
              No se pudo cargar el reporte
            </h3>
            <p className="mono" style={{ fontSize: 11, color: "var(--text-2)", wordBreak: "break-all", margin: 0 }}>{error}</p>
            <div>
              <ButtonNew size="sm" variant="secondary" onClick={load}>Reintentar</ButtonNew>
            </div>
          </div>
        </CardNew>
      ) : !data || !hasData ? (
        <CardNew>
          <div style={{ padding: "40px 18px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 32 }}>📊</div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
              Sin datos todavía
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 420, margin: 0 }}>
              Aún no hay clínicas pagando o registros en este periodo. En cuanto registres pagos de suscripción desde /admin/payments, aparecerán aquí las métricas.
            </p>
          </div>
        </CardNew>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* KPI row 1 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14 }}>
            <KpiCard label="MRR" value={formatCurrency(data.summary.mrr, "MXN")} icon={DollarSign}
              delta={{ value: "Recurrente mensual", direction: "up" }} />
            <KpiCard label="ARR" value={formatCurrency(data.summary.arr, "MXN")} icon={TrendingUp}
              delta={{ value: "Anual proyectado", direction: "up" }} />
            <KpiCard label="ARPU" value={formatCurrency(data.summary.arpu, "MXN")} icon={Users}
              delta={{ value: "Por cliente activo", direction: "up" }} />
            <KpiCard label="LTV estimado" value={formatCurrency(data.summary.ltv, "MXN")} icon={Activity}
              delta={{ value: "Valor de vida", direction: "up" }} />
          </div>

          {/* KPI row 2 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14 }}>
            <KpiCard label="Churn rate" value={`${data.summary.churnRate}%`}
              delta={{ value: "Mensual", direction: data.summary.churnRate > 5 ? "down" : "up" }} />
            <KpiCard label="Conversión trial" value={`${data.summary.trialConversion}%`}
              delta={{ value: "Trial → pagado", direction: "up" }} />
            <KpiCard label="Ingresos periodo" value={formatCurrency(data.summary.periodRevenue, "MXN")}
              delta={{ value: `${data.summary.periodPayments} pagos`, direction: "up" }} />
            <KpiCard label="# Pagos periodo" value={String(data.summary.periodPayments)}
              delta={{ value: `${data.summary.newClinicsPeriod} nuevas`, direction: "up" }} />
          </div>

          {/* Chart: ingresos mensuales */}
          <CardNew title="Ingresos mensuales" sub="Evolución del revenue cobrado por mes">
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                  <XAxis dataKey="label" stroke="var(--text-3)" fontSize={11} />
                  <YAxis stroke="var(--text-3)" fontSize={11} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: "rgba(124,58,237,0.08)" }}
                  />
                  <Bar dataKey="paid" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardNew>

          {/* Chart: clínicas nuevas vs churn */}
          <CardNew title="Nuevas vs churn (mensual)" sub="Crecimiento neto de clínicas">
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" />
                  <XAxis dataKey="label" stroke="var(--text-3)" fontSize={11} />
                  <YAxis stroke="var(--text-3)" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-3)" }} />
                  <Line type="monotone" dataKey="newClinics" name="Nuevas" stroke="var(--success)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="churned"    name="Churn"  stroke="var(--danger)"  strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardNew>

          {/* Evolution table */}
          <CardNew noPad title="Evolución mensual">
            <table className="table-new">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th style={{ textAlign: "right" }}>Ingresos</th>
                  <th style={{ textAlign: "right" }}># Pagos</th>
                  <th style={{ textAlign: "right" }}>Nuevas</th>
                  <th style={{ textAlign: "right" }}>Churn</th>
                  <th style={{ textAlign: "right" }}>Neto</th>
                </tr>
              </thead>
              <tbody>
                {data.monthlySeries.map(m => {
                  const net = (m.newClinics ?? 0) - (m.churned ?? 0);
                  return (
                    <tr key={m.month}>
                      <td className="mono" style={{ color: "var(--text-2)" }}>{m.month}</td>
                      <td className="mono" style={{ textAlign: "right", color: "var(--text-1)", fontWeight: 500 }}>
                        {formatCurrency(m.paid, "MXN")}
                      </td>
                      <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>{m.payments}</td>
                      <td className="mono" style={{ textAlign: "right", color: "var(--success)" }}>+{m.newClinics}</td>
                      <td className="mono" style={{ textAlign: "right", color: "var(--danger)" }}>-{m.churned}</td>
                      <td className="mono" style={{ textAlign: "right", color: net >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 500 }}>
                        {net >= 0 ? `+${net}` : net}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardNew>
        </div>
      )}
    </div>
  );
}
