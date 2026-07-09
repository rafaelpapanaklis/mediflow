"use client";

import { useEffect, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BarList, LoadingState, ErrorState, EmptyState, SERIES } from "./ui";
import { HeatmapCanvas } from "./heatmap-canvas";
import { formatNumber } from "@/lib/analytics/format";
import type { HeatmapResponse } from "@/lib/analytics/types";
import type { TabProps } from "./analytics-client";

export function HeatmapTab({ query }: TabProps) {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [path, setPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const pathParam = path ? `&path=${encodeURIComponent(path)}` : "";
    fetch(`/api/admin/analytics/heatmap?${query}${pathParam}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d: HeatmapResponse) => {
        setData(d);
        if (!path && d.path) setPath(d.path);
        setLoading(false);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError(e.message || "Error");
        setLoading(false);
      });
    return () => ctrl.abort();
    // path incluido: refetch al cambiar de página
  }, [query, path, tick]);

  if (loading && !data) return <CardNew><LoadingState /></CardNew>;
  if (error) return <CardNew><ErrorState message={error} onRetry={() => setTick((t) => t + 1)} /></CardNew>;
  if (!data || data.paths.length === 0)
    return (
      <CardNew>
        <EmptyState icon="🖱️" title="Sin clicks registrados" hint="El heatmap muestra dónde hacen click los visitantes en cada página. Aparece cuando haya interacción registrada." />
      </CardNew>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CardNew>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Página</span>
            <select className="input-new" value={path} onChange={(e) => setPath(e.target.value)} style={{ minWidth: 240, maxWidth: 420 }}>
              {data.paths.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path} ({formatNumber(p.clicks)})
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>{formatNumber(data.total)} clicks</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
              <span>frío</span>
              <span style={{ width: 90, height: 8, borderRadius: 999, background: "linear-gradient(90deg,#1e3a8a,#06b6d4,#22c55e,#eab308,#ef4444)" }} />
              <span>caliente</span>
            </div>
          </div>
        </div>
      </CardNew>

      <div className="an-2col">
        <CardNew noPad title="Mapa de calor de clicks" sub="Posición normalizada por ancho de viewport y alto de página">
          <div style={{ padding: 12, opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
            <HeatmapCanvas points={data.points} />
          </div>
        </CardNew>
        <CardNew title="Elementos más clickeados">
          <BarList
            items={data.elements.map((el) => ({
              label: el.text ? el.text : el.selector,
              value: el.count,
              display: formatNumber(el.count),
              sub: el.text ? el.selector : undefined,
            }))}
            color={SERIES[4]}
          />
        </CardNew>
      </div>
    </div>
  );
}
