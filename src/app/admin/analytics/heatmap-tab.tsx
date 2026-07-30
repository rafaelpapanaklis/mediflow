"use client";

import { useEffect, useMemo, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BarList, LoadingState, ErrorState, EmptyState, SERIES } from "./ui";
import { HeatmapCanvas } from "./heatmap-canvas";
import { HeatmapStage } from "./heatmap-stage";
import {
  DEVICE_GROUPS,
  countByDevice,
  dominantDevice,
  filterByDevice,
  type DeviceKey,
} from "./heatmap-geom";
import { formatNumber } from "@/lib/analytics/format";
import type { HeatmapResponse, HeatPoint } from "@/lib/analytics/types";
import type { TabProps } from "./analytics-client";

/** Referencia estable: evita invalidar los useMemo mientras no hay datos. */
const NO_POINTS: HeatPoint[] = [];

export function HeatmapTab({ query }: TabProps) {
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [path, setPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [showPage, setShowPage] = useState(true); // fondo = página real vs. mapa simple
  // null = automático (grupo con más clicks). Se resetea al cambiar de página.
  const [device, setDevice] = useState<DeviceKey | null>(null);

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

  // Los clicks de móvil (vw≈375) sobre un layout renderizado a ~1280 caen donde no hay
  // nada: el mapa se dibuja SIEMPRE con un solo grupo de viewport. Filtrado en cliente
  // (los puntos ya vienen todos) → cambiar de dispositivo no re-consulta.
  const points = data?.points ?? NO_POINTS;
  const counts = useMemo(() => countByDevice(points), [points]);
  const autoDevice = useMemo(() => dominantDevice(points), [points]);
  const activeDevice = device ?? autoDevice;
  const shown = useMemo(() => filterByDevice(points, activeDevice), [points, activeDevice]);

  if (loading && !data) return <CardNew><LoadingState /></CardNew>;
  if (error) return <CardNew><ErrorState message={error} onRetry={() => setTick((t) => t + 1)} /></CardNew>;
  if (!data || data.paths.length === 0)
    return (
      <CardNew>
        <EmptyState icon="🖱️" title="Aún no hay clicks en este rango" hint="El mapa de calor traza los clicks reales sobre cada página (no scroll ni movimiento del mouse). En cuanto un visitante haga click en el sitio dentro del rango de fechas seleccionado, aparecerá aquí." />
      </CardNew>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CardNew>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Página</span>
            <select
              className="input-new"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setDevice(null); // otra página, otro grupo dominante
              }}
              style={{ minWidth: 240, maxWidth: 420 }}
            >
              {data.paths.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path} ({formatNumber(p.clicks)})
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Dispositivo</span>
            <select
              className="input-new"
              value={activeDevice}
              onChange={(e) => setDevice(e.target.value as DeviceKey)}
              style={{ minWidth: 170 }}
            >
              {DEVICE_GROUPS.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label} ({formatNumber(counts[g.key])})
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)", cursor: "pointer" }}>
              <input type="checkbox" checked={showPage} onChange={(e) => setShowPage(e.target.checked)} />
              Página de fondo
            </label>
            <span
              style={{ fontSize: 12, color: "var(--text-3)" }}
              title={
                data.total > points.length
                  ? `Se grafican los ${formatNumber(points.length)} clicks más recientes de ${formatNumber(data.total)}.`
                  : undefined
              }
            >
              {formatNumber(shown.length)} de {formatNumber(points.length)} clicks
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
              <span>frío</span>
              <span style={{ width: 90, height: 8, borderRadius: 999, background: "linear-gradient(90deg,#1e3a8a,#06b6d4,#22c55e,#eab308,#ef4444)" }} />
              <span>caliente</span>
            </div>
          </div>
        </div>
      </CardNew>

      <div className="an-2col">
        <CardNew
          noPad
          title="Mapa de calor de clicks"
          sub={
            showPage
              ? `Clicks sobre la página real · ${DEVICE_GROUPS.find((g) => g.key === activeDevice)?.label}`
              : `Posición absoluta de los clicks · ${DEVICE_GROUPS.find((g) => g.key === activeDevice)?.label}`
          }
        >
          <div style={{ padding: 12, opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
            {showPage ? <HeatmapStage points={shown} path={path} /> : <HeatmapCanvas points={shown} />}
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
