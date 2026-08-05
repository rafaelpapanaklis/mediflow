"use client";

import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Activity, AlertTriangle, MousePointerClick } from "lucide-react";
import type { AffiliateStatsResponse, StatsRange } from "@/lib/affiliates/stats";
import { formatCurrency } from "@/lib/utils";
import {
  EmptyState,
  Eyebrow,
  Footnote,
  Kpi,
  PanelCard,
  ProgressBar,
  SectionHead,
  Stat,
  StatRow,
} from "@/components/afiliados/ui/panel-ui";

/**
 * Cliente de /afiliados/estadisticas: rango 7/30/90 → funnel, serie temporal
 * (clicks + registros), KPIs de comisiones y desglose por ref/campaña.
 * Data de /api/afiliados/stats (contrato en @/lib/affiliates/stats).
 *
 * Estilo: clases `dcafp-*` de src/app/afiliados/panel.css. El panel es
 * SIEMPRE claro, así que nada de blancos translúcidos ni neones: la rejilla
 * del gráfico, los ejes y las series se pintan con la paleta de ese archivo.
 */

const RANGES: { value: StatsRange; label: string }[] = [
  { value: 7, label: "7 días" },
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
];

/**
 * Colores del gráfico. Recharts los escribe como ATRIBUTOS de SVG (stroke,
 * stopColor), donde `var(--dcafp-*)` no se sustituye de forma fiable: por eso
 * aquí van en hexadecimal, con el token equivalente anotado al lado. Los
 * `style` de React (tooltip) sí usan las variables directamente.
 */
const CHART = {
  clicks: "#7c3aed", // var(--dcafp-brand)
  signups: "#15803d", // var(--dcafp-ok)
  grid: "#f1f5f9", // var(--dcafp-line-soft)
  axis: "#64748b", // var(--dcafp-ink-3)
  cursor: "#a78bfa", // var(--dcafp-brand-300)
};

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

/**
 * De dónde sale la proyección mensual. Con el programa en montos fijos NO es un
 * % del MRR: es la suma de los fijos de las clínicas con modalidad recurrente
 * (las de pago único ya cobraron su comisión una sola vez).
 */
function projectionCaption(c: AffiliateStatsResponse["commissions"]): string {
  if (c.projectionBasis !== "fixed") {
    return `La proyección mensual equivale a ≈ ${c.commissionPct}% del MRR referido.`;
  }
  const onetimeNote =
    c.onetimeClinics > 0 ? ` Las de pago único (${c.onetimeClinics}) no suman cada mes.` : "";
  if (c.recurringClinics === 0) {
    return `Con montos fijos solo suman cada mes las clínicas de pago recurrente.${onetimeNote}`;
  }
  const plural = c.recurringClinics === 1 ? "clínica" : "clínicas";
  return `Suma de los montos fijos de tus ${c.recurringClinics} ${plural} con pago recurrente.${onetimeNote}`;
}

/** "3 comisiones" / "1 comisión" — el conteo viene de la API, nunca escrito. */
function commissionCount(n: number): string {
  return `${n.toLocaleString("es-MX")} ${n === 1 ? "comisión" : "comisiones"}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        color: "var(--dcafp-ink-3)",
      }}
    >
      <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

/** Cuatro casillas de esqueleto: tantas como etapas del funnel y KPIs. */
const SKELETON_SLOTS = ["s1", "s2", "s3", "s4"];

/** Bloque gris con la forma de lo que va a llegar. Solo adorno: aria-hidden. */
function SkeletonBlock({ height, width = "100%", radius = 999 }: { height: number; width?: number | string; radius?: number }) {
  return (
    <div
      aria-hidden
      className="animate-pulse"
      style={{ height, width, borderRadius: radius, background: "var(--dcafp-line)" }}
    />
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
  // Escala de las barras. No sirve `clicks` a secas: el registro de clicks es
  // nuevo, así que puede haber 0 clicks y 4 registros — con esa escala las
  // barras saldrían todas llenas.
  const funnelMax = funnel ? Math.max(funnel.clicks, funnel.signups, funnel.active, funnel.paying) : 0;
  const globalConv = funnel ? pct(funnel.paying, funnel.clicks) : null;
  const trackedSince = data?.clicksTrackedSince
    ? new Date(data.clicksTrackedSince).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const hasSeries = data ? data.series.some((p) => p.clicks > 0 || p.signups > 0) : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
      {/* Selector de rango */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", minWidth: 0 }}>
        <Eyebrow>Periodo</Eyebrow>
        <div role="group" aria-label="Periodo de las estadísticas" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {RANGES.map((r) => {
            const active = r.value === range;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                aria-pressed={active}
                className={`dcafp-btn${active ? " dcafp-btn--outline" : ""}`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}
        >
          <p className="dcafp-hint">Cargando tus estadísticas…</p>
          <section className="dcafp-card">
            <SkeletonBlock height={16} width={180} />
            <div className="dcafp-plangrid" style={{ marginTop: 18 }}>
              {SKELETON_SLOTS.map((slot) => (
                <div key={slot} className="dcafp-planbox" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  <SkeletonBlock height={11} width="60%" />
                  <SkeletonBlock height={20} width="80%" radius={8} />
                  <SkeletonBlock height={10} width="45%" />
                </div>
              ))}
            </div>
          </section>
          <section className="dcafp-card">
            <SkeletonBlock height={16} width={140} />
            <div style={{ marginTop: 18 }}>
              <SkeletonBlock height={220} radius={12} />
            </div>
          </section>
          <div className="dcafp-autogrid dcafp-autogrid--sm">
            {SKELETON_SLOTS.map((slot) => (
              <div key={slot} className="dcafp-kpi">
                <SkeletonBlock height={11} width="65%" />
                <SkeletonBlock height={22} width="75%" radius={8} />
              </div>
            ))}
          </div>
        </div>
      ) : !data ? (
        <PanelCard>
          <EmptyState
            icon={<AlertTriangle size={22} />}
            title="No pudimos cargar tus estadísticas"
            action={
              <button type="button" className="dcafp-btn dcafp-btn--outline" onClick={() => setReloadKey((k) => k + 1)}>
                Reintentar
              </button>
            }
          >
            Revisa tu conexión e inténtalo de nuevo. Tus comisiones no se ven afectadas: esto solo es la pantalla.
          </EmptyState>
        </PanelCard>
      ) : (
        <>
          {/* Funnel */}
          <PanelCard
            title="Funnel de conversión"
            sub="Del click en tu enlace hasta la clínica que ya paga."
          >
            {funnelMax === 0 ? (
              <EmptyState icon={<MousePointerClick size={22} />} title="Tu funnel empieza con el primer click">
                En cuanto alguien abra tu enlace verás aquí cuántos entran, cuántos se registran y cuántos terminan
                pagando.
              </EmptyState>
            ) : (
              <>
                <div className="dcafp-plangrid">
                  {stages.map((s) => {
                    const conv = s.prev === null ? null : pct(s.value, s.prev);
                    return (
                      <div key={s.label} className="dcafp-planbox">
                        <div className="dcafp-planbox__k">{s.label}</div>
                        <div className="dcafp-planbox__v">{s.value.toLocaleString("es-MX")}</div>
                        <div style={{ margin: "8px 0 7px" }}>
                          <ProgressBar
                            value={s.value}
                            max={funnelMax}
                            label={`${s.label}: ${s.value.toLocaleString("es-MX")} de ${funnelMax.toLocaleString("es-MX")}`}
                          />
                        </div>
                        <div
                          className="dcafp-planbox__u"
                          style={{ minHeight: 17, color: conv ? "var(--dcafp-brand-deep)" : "var(--dcafp-ink-4)", fontWeight: 700 }}
                        >
                          {s.prev === null ? "" : conv ? `↓ ${conv}` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 16 }}>
                  <StatRow>
                    <Stat
                      label="Conversión global · clicks → pagando"
                      value={globalConv ?? "—"}
                      tone={globalConv ? "default" : "idle"}
                    />
                  </StatRow>
                </div>
                {trackedSince && (
                  <div style={{ marginTop: 10 }}>
                    <Footnote>Los clicks se registran desde {trackedSince}.</Footnote>
                  </div>
                )}
              </>
            )}
          </PanelCard>

          {/* Serie temporal */}
          <PanelCard
            title="Actividad"
            sub="Clicks en tus enlaces y registros de clínicas, día por día."
            action={
              hasSeries ? (
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <LegendDot color={CHART.clicks} label="Clicks" />
                  <LegendDot color={CHART.signups} label="Registros" />
                </div>
              ) : undefined
            }
          >
            {!hasSeries ? (
              <EmptyState icon={<Activity size={22} />} title="Sin movimiento en este periodo">
                Comparte tu enlace y la gráfica se llenará con los clicks de cada día y las clínicas que se registren.
                Prueba también con un periodo más amplio.
              </EmptyState>
            ) : (
              <div className="dcafp-scrollx">
                <div style={{ width: "100%", minWidth: 260, height: 260 }}>
                  <ResponsiveContainer>
                    <AreaChart data={data.series} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="afStatsClicksFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART.clicks} stopOpacity={0.24} />
                          <stop offset="100%" stopColor={CHART.clicks} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="afStatsSignupsFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART.signups} stopOpacity={0.2} />
                          <stop offset="100%" stopColor={CHART.signups} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke={CHART.axis}
                        tick={{ fontSize: 10, fill: CHART.axis }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={24}
                        tickFormatter={shortDay}
                      />
                      <YAxis
                        stroke={CHART.axis}
                        tick={{ fontSize: 10, fill: CHART.axis }}
                        axisLine={false}
                        tickLine={false}
                        width={36}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--dcafp-surface)",
                          border: "1px solid var(--dcafp-line)",
                          borderRadius: 12,
                          fontSize: 12,
                          color: "var(--dcafp-ink)",
                          boxShadow: "0 12px 30px -18px rgba(15, 23, 42, .45)",
                        }}
                        labelStyle={{ color: "var(--dcafp-ink-3)", fontWeight: 700, marginBottom: 2 }}
                        itemStyle={{ color: "var(--dcafp-ink)" }}
                        cursor={{ stroke: CHART.cursor, strokeWidth: 1 }}
                        labelFormatter={(label: string) => tooltipDay(label)}
                        formatter={(v: number, name: string) => [Number(v).toLocaleString("es-MX"), name]}
                      />
                      <Area
                        type="monotone"
                        dataKey="clicks"
                        name="Clicks"
                        stroke={CHART.clicks}
                        strokeWidth={2}
                        fill="url(#afStatsClicksFill)"
                      />
                      <Area
                        type="monotone"
                        dataKey="signups"
                        name="Registros"
                        stroke={CHART.signups}
                        strokeWidth={2}
                        fill="url(#afStatsSignupsFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </PanelCard>

          {/* Comisiones */}
          <div style={{ minWidth: 0 }}>
            <SectionHead title="Comisiones" />
            <div className="dcafp-autogrid dcafp-autogrid--sm">
              <Kpi
                label="Pendiente de pago"
                value={formatCurrency(data.commissions.pendingMxn)}
                sub={commissionCount(data.commissions.pendingCount)}
              />
              <Kpi
                label="Pagado"
                value={formatCurrency(data.commissions.paidMxn)}
                sub={commissionCount(data.commissions.paidCount)}
              />
              <Kpi label="MRR de tus clínicas" value={formatCurrency(data.commissions.mrrMxn)} />
              <Kpi label="Proyección mensual" value={formatCurrency(data.commissions.projectedMonthlyMxn)} />
            </div>
            <div style={{ marginTop: 10 }}>
              <Footnote>{projectionCaption(data.commissions)}</Footnote>
            </div>
          </div>

          {/* Por enlace / campaña */}
          <PanelCard
            title="Clicks por enlace"
            sub="De dónde llega la gente que abre tus enlaces."
            flush={data.byRef.length > 0}
          >
            {data.byRef.length === 0 ? (
              <EmptyState icon={<MousePointerClick size={22} />} title="Aún no hay clicks en este periodo">
                Cuando compartas tus enlaces verás aquí cuál de ellos trae más gente y desde qué campaña llega.
              </EmptyState>
            ) : (
              <div className="dcafp-scrollx">
                <table className="dcafp-table">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Campaña</th>
                      <th style={{ textAlign: "right" }}>Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byRef.map((row) => (
                      <tr key={`${row.ref}::${row.campaign ?? ""}`}>
                        <td className="dcafp-mono">{row.ref}</td>
                        <td className="dcafp-td--muted">{row.campaign ?? "—"}</td>
                        <td className="dcafp-td--num">{row.clicks.toLocaleString("es-MX")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PanelCard>
        </>
      )}
    </div>
  );
}
