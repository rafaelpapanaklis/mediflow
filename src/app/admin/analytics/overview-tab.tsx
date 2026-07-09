"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { CardNew } from "@/components/ui/design-system/card-new";
import { StatTile, BarList, LoadingState, ErrorState, EmptyState, SERIES, TOOLTIP_STYLE } from "./ui";
import { formatNumber, formatDuration, formatPct } from "@/lib/analytics/format";
import type { OverviewResponse, BucketUnit } from "@/lib/analytics/types";
import type { TabProps } from "./analytics-client";

function fmtBucket(b: string, unit: BucketUnit): string {
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  if (unit === "hour") return `${b.slice(11, 13)}:00`;
  if (unit === "day") {
    const [, m, d] = b.split("-");
    return `${d}/${m}`;
  }
  const [, m] = b.split("-");
  return months[Number(m) - 1] || b;
}

export function OverviewTab({ query }: TabProps) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics?section=overview&${query}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(e.message || "Error");
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, tick]);

  const chartData = useMemo(
    () => (data ? data.timeseries.map((p) => ({ ...p, label: fmtBucket(p.bucket, data.bucket) })) : []),
    [data],
  );

  if (loading && !data) return <CardNew><LoadingState /></CardNew>;
  if (error) return <CardNew><ErrorState message={error} onRetry={() => setTick((t) => t + 1)} /></CardNew>;
  if (!data || data.kpis.visits === 0)
    return (
      <CardNew>
        <EmptyState
          title="Sin visitas todavía"
          hint="En cuanto haya tráfico en el sitio o el panel, verás aquí visitas, visitantes únicos, rebote, duración y más. El tracker ya está activo."
        />
      </CardNew>
    );

  const k = data.kpis;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <StatTile label="Visitas" value={formatNumber(k.visits)} sub={`${formatNumber(k.pagesPerVisit)} págs/visita`} />
        <StatTile label="Visitantes únicos" value={formatNumber(k.uniqueVisitors)} sub={`${formatNumber(k.newVisitors)} nuevos · ${formatNumber(k.returningVisitors)} recurrentes`} />
        <StatTile label="Páginas vistas" value={formatNumber(k.pageviews)} />
        <StatTile
          label="Tasa de rebote"
          value={formatPct(k.bounceRate)}
          tone={k.bounceRate > 60 ? "bad" : k.bounceRate < 40 ? "good" : "warn"}
        />
        <StatTile label="Duración media" value={formatDuration(k.avgDurationMs)} />
        <StatTile label="Clicks" value={formatNumber(k.clicks)} />
        <StatTile label="Identificadas" value={formatNumber(k.identifiedVisits)} sub="visitas de registrados" />
        <StatTile label="En vivo" value={formatNumber(k.liveNow)} tone={k.liveNow > 0 ? "good" : "default"} sub="últimos 5 min" />
      </div>

      {/* Serie temporal */}
      <CardNew title="Tráfico en el tiempo" sub="Visitas, visitantes únicos y páginas vistas">
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="gvisits" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-soft)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--text-3)" fontSize={11} tickLine={false} minTickGap={24} />
              <YAxis stroke="var(--text-3)" fontSize={11} tickLine={false} allowDecimals={false} width={40} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "var(--border-soft)" }} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--text-3)" }} />
              <Area type="monotone" dataKey="visits" name="Visitas" stroke={SERIES[0]} strokeWidth={2} fill="url(#gvisits)" />
              <Line type="monotone" dataKey="visitors" name="Únicos" stroke={SERIES[1]} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="pageviews" name="Páginas" stroke={SERIES[2]} strokeWidth={1.6} dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardNew>

      {/* Desgloses de dispositivo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        <CardNew title="Dispositivos">
          <BarList items={data.devices.map((d) => ({ label: cap(d.key), value: d.count, display: formatNumber(d.count) }))} color={SERIES[0]} />
        </CardNew>
        <CardNew title="Navegadores">
          <BarList items={data.browsers.map((d) => ({ label: d.key, value: d.count, display: formatNumber(d.count) }))} color={SERIES[1]} />
        </CardNew>
        <CardNew title="Sistema operativo">
          <BarList items={data.os.map((d) => ({ label: d.key, value: d.count, display: formatNumber(d.count) }))} color={SERIES[2]} />
        </CardNew>
      </div>
    </div>
  );
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
