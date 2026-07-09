"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BarList, LoadingState, ErrorState, EmptyState, SERIES } from "./ui";
import { formatNumber, countryName, countryFlag } from "@/lib/analytics/format";
import type { GeoResponse } from "@/lib/analytics/types";
import type { MapMarker } from "./analytics-map";
import type { TabProps } from "./analytics-client";

const AnalyticsMap = dynamic(() => import("./analytics-map").then((m) => m.AnalyticsMap), {
  ssr: false,
  loading: () => (
    <div style={{ height: 440, display: "grid", placeItems: "center", color: "var(--text-3)", fontSize: 13, border: "1px solid var(--border-soft)", borderRadius: 12 }}>
      Cargando mapa…
    </div>
  ),
});

export function GeoTab({ query }: TabProps) {
  const [data, setData] = useState<GeoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics?section=geo&${query}`, { signal: ctrl.signal })
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

  const markers = useMemo<MapMarker[]>(
    () =>
      (data?.points ?? [])
        .filter((p) => p.lat != null && p.lng != null)
        .map((p) => ({
          lat: p.lat as number,
          lng: p.lng as number,
          label: p.city || countryName(p.country),
          sub: `${formatNumber(p.visits)} visitas`,
          value: p.visits,
        })),
    [data],
  );

  if (loading && !data) return <CardNew><LoadingState /></CardNew>;
  if (error) return <CardNew><ErrorState message={error} onRetry={() => setTick((t) => t + 1)} /></CardNew>;
  if (!data || data.countries.length === 0)
    return (
      <CardNew>
        <EmptyState
          icon="🌎"
          title="Sin datos de ubicación"
          hint="La geolocalización viene de los headers de Vercel (país/ciudad/coordenadas). Aparece automáticamente cuando el sitio recibe tráfico ya desplegado en producción."
        />
      </CardNew>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <CardNew noPad title="Mapa de visitantes" sub="Tamaño del punto = volumen de visitas">
        <div style={{ padding: 12 }}>
          <AnalyticsMap markers={markers} height={460} />
          {markers.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>
              Hay visitas por país pero sin coordenadas exactas (típico en desarrollo local; en producción Vercel las agrega).
            </p>
          )}
        </div>
      </CardNew>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        <CardNew title="Países">
          <BarList
            items={data.countries.map((c) => ({
              label: (
                <span>
                  <span style={{ marginRight: 6 }}>{countryFlag(c.country)}</span>
                  {countryName(c.country)}
                </span>
              ),
              value: c.visits,
              display: formatNumber(c.visits),
              sub: `${formatNumber(c.visitors)} únicos`,
            }))}
            color={SERIES[0]}
          />
        </CardNew>

        <CardNew noPad title="Ciudades">
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Ciudad</th>
                  <th>País</th>
                  <th style={{ textAlign: "right" }}>Visitas</th>
                  <th style={{ textAlign: "right" }}>Únicos</th>
                </tr>
              </thead>
              <tbody>
                {data.cities.map((c, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--text-1)" }}>{c.city || "—"}</td>
                    <td style={{ color: "var(--text-2)" }}>
                      {countryFlag(c.country)} {countryName(c.country)}
                    </td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-1)" }}>{formatNumber(c.visits)}</td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-3)" }}>{formatNumber(c.visitors)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardNew>
      </div>
    </div>
  );
}
