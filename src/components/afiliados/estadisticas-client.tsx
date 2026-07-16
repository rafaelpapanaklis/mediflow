"use client";

import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Clock, Wallet, TrendingUp, Sparkles } from "lucide-react";
import type { AffiliateStatsResponse, StatsRange } from "@/lib/affiliates/stats";
import { formatCurrency } from "@/lib/utils";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";

/**
 * Cliente de /afiliados/estadisticas: rango 7/30/90 → funnel, serie temporal
 * (clicks + registros), KPIs de comisiones y desglose por ref/campaña.
 * Data de /api/afiliados/stats (contrato en @/lib/affiliates/stats).
 */

const RANGES: { value: StatsRange; label: string }[] = [
  { value: 7, label: "7 días" },
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
];

/** % num/den con 1 decimal (es-MX) o null si den ≤ 0. */
function pct(num: number, den: number): string | null {
  if (den <= 0) return null;
  return `${((num / den) * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;
}

/** 'YYYY-MM-DD' → "d/m" sin pasar por Date (evita corrimientos de zona). */
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/** 'YYYY-MM-DD' → "9 jun" para el tooltip. */
function tooltipDay(iso: string): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)" }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

export function EstadisticasClient() {
  const [range, setRange] = useState<StatsRange>(30);
  const [data, setData] = useState<AffiliateStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/afiliados/stats?range=${range}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [range, reloadKey]);

  const funnel = data?.funnel;
  const stages = funnel
    ? [
        { label: "Clicks", value: funnel.clicks, prev: null as number | null },
        { label: "Registros", value: funnel.signups, prev: funnel.clicks },
        { label: "Activas", value: funnel.active, prev: funnel.signups },
        { label: "Pagando", value: funnel.paying, prev: funnel.active },
      ]
    : [];
  const globalConv = funnel ? pct(funnel.paying, funnel.clicks) : null;
  const trackedSince = data?.clicksTrackedSince
    ? new Date(data.clicksTrackedSince).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Selector de rango */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {RANGES.map((r) => {
          const active = r.value === range;
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              aria-pressed={active}
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s, border-color 0.15s",
                background: active ? "var(--brand-soft)" : "var(--bg-elev-2)",
                color: active ? "var(--violet-400)" : "var(--text-3)",
                border: active ? "1px solid var(--border-brand)" : "1px solid var(--border-soft)",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <>
          <div className="animate-pulse" style={{ height: 140, background: "var(--bg-elev-2)", borderRadius: 12 }} />
          <div className="animate-pulse" style={{ height: 300, background: "var(--bg-elev-2)", borderRadius: 12 }} />
          <div className="animate-pulse" style={{ height: 110, background: "var(--bg-elev-2)", borderRadius: 12 }} />
        </>
      ) : !data ? (
        <CardNew>
          <div style={{ padding: "24px 8px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <p style={{ color: "var(--text-2)", fontSize: 13, margin: 0 }}>
              No pudimos cargar tus estadísticas. Revisa tu conexión e inténtalo de nuevo.
            </p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              style={{
                padding: "7px 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: "var(--brand-soft)",
                color: "var(--violet-400)",
                border: "1px solid var(--border-brand)",
              }}
            >
              Reintentar
            </button>
          </div>
        </CardNew>
      ) : (
        <>
          {/* Funnel */}
          <CardNew title="Funnel de conversión">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
              {stages.map((s) => {
                const conv = s.prev === null ? null : pct(s.value, s.prev);
                return (
                  <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>
                      {s.value.toLocaleString("es-MX")}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{s.label}</div>
                    <div style={{ fontSize: 12, minHeight: 18, color: conv ? "var(--violet-400)" : "var(--text-3)", fontWeight: 600 }}>
                      {s.prev === null ? "" : conv ? `↓ ${conv}` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
              <div style={{ fontSize: 13, color: "var(--text-2)" }}>
                Conversión global Clicks → Pagando:{" "}
                <span style={{ color: "var(--violet-400)", fontWeight: 700 }}>{globalConv ?? "—"}</span>
              </div>
              {trackedSince && (
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                  Los clicks se registran desde {trackedSince}.
                </div>
              )}
            </div>
          </CardNew>

          {/* Serie temporal */}
          <CardNew
            title="Actividad"
            action={
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <LegendDot color="#7c3aed" label="Clicks" />
                <LegendDot color="#2563eb" label="Registros" />
              </div>
            }
          >
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={data.series} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="afStatsClicksFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="afStatsSignupsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="date"
                    stroke="var(--text-4)"
                    tick={{ fontSize: 10, fill: "var(--text-4)" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                    tickFormatter={shortDay}
                  />
                  <YAxis
                    stroke="var(--text-4)"
                    tick={{ fontSize: 10, fill: "var(--text-4)" }}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--bg-elev)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "var(--text-1)",
                    }}
                    cursor={{ stroke: "rgba(124,58,237,0.35)" }}
                    labelFormatter={(label: string) => tooltipDay(label)}
                    formatter={(v: number, name: string) => [Number(v).toLocaleString("es-MX"), name]}
                  />
                  <Area type="monotone" dataKey="clicks" name="Clicks" stroke="#7c3aed" strokeWidth={2} fill="url(#afStatsClicksFill)" />
                  <Area type="monotone" dataKey="signups" name="Registros" stroke="#2563eb" strokeWidth={2} fill="url(#afStatsSignupsFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardNew>

          {/* Comisiones */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14 }}>
              <KpiCard label="Pendiente de pago" value={formatCurrency(data.commissions.pendingMxn)} icon={Clock} />
              <KpiCard label="Pagado" value={formatCurrency(data.commissions.paidMxn)} icon={Wallet} />
              <KpiCard label="MRR de tus clínicas" value={formatCurrency(data.commissions.mrrMxn)} icon={TrendingUp} />
              <KpiCard label="Proyección mensual" value={formatCurrency(data.commissions.projectedMonthlyMxn)} icon={Sparkles} />
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>
              La proyección mensual equivale a ≈ {data.commissions.commissionPct}% del MRR referido.
            </div>
          </div>

          {/* Por enlace / campaña */}
          <CardNew noPad title="Clicks por enlace">
            {data.byRef.length === 0 ? (
              <div style={{ padding: "36px 24px", textAlign: "center" }}>
                <p style={{ color: "var(--text-3)", fontSize: 13, margin: 0 }}>
                  Aún no hay clicks registrados en este rango. Comparte tu enlace y aquí verás de dónde llegan.
                </p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Campaña</th>
                      <th>Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byRef.map((row) => (
                      <tr key={`${row.ref}::${row.campaign ?? ""}`}>
                        <td className="mono" style={{ color: "var(--text-1)" }}>{row.ref}</td>
                        <td style={{ color: "var(--text-2)" }}>{row.campaign ?? "—"}</td>
                        <td className="mono" style={{ color: "var(--text-1)", fontWeight: 600 }}>
                          {row.clicks.toLocaleString("es-MX")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardNew>
        </>
      )}
    </div>
  );
}
