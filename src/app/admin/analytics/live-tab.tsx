"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BarList, LoadingState, ErrorState, EmptyState, Chip, SERIES } from "./ui";
import { formatNumber, formatRelative, countryName, countryFlag, surfaceLabel, identityLabel } from "@/lib/analytics/format";
import type { LiveResponse } from "@/lib/analytics/types";
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

const POLL_MS = 5000;

export function LiveTab(_: TabProps) {
  const [data, setData] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch(`/api/admin/analytics/live`, { cache: "no-store" });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        const d = await r.json();
        if (!alive) return;
        setData(d);
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setError(e.message || "Error");
        setLoading(false);
      }
    }
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const markers = useMemo<MapMarker[]>(
    () =>
      (data?.visitors ?? [])
        .filter((v) => v.lat != null && v.lng != null)
        .map((v) => ({
          lat: v.lat as number,
          lng: v.lng as number,
          label: v.clinicName || countryName(v.country),
          sub: v.path,
          live: true,
        })),
    [data],
  );

  if (loading && !data) return <CardNew><LoadingState label="Buscando visitantes en vivo…" /></CardNew>;
  if (error && !data) return <CardNew><ErrorState message={error} /></CardNew>;

  const count = data?.count ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header en vivo */}
      <div className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{ position: "relative", display: "inline-flex", width: 12, height: 12 }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: "var(--success)", opacity: 0.4, animation: "daPing 1.6s cubic-bezier(0,0,.2,1) infinite" }} />
          <span style={{ position: "relative", width: 12, height: 12, borderRadius: 999, background: "var(--success)" }} />
        </span>
        <style dangerouslySetInnerHTML={{ __html: `@keyframes daPing{75%,100%{transform:scale(2.2);opacity:0}}` }} />
        <div>
          <div style={{ fontSize: 26, fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
            {formatNumber(count)} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-3)" }}>{count === 1 ? "visitante ahora" : "visitantes ahora"}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
            Activos en los últimos {data?.windowSeconds ?? 75}s · se actualiza cada 5s
          </div>
        </div>
      </div>

      {count === 0 ? (
        <CardNew>
          <EmptyState icon="👀" title="Nadie navegando ahora mismo" hint="Esta vista se actualiza sola. Cuando alguien entre al sitio o al panel, aparecerá aquí en tiempo real." />
        </CardNew>
      ) : (
        <div className="an-2col">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <CardNew noPad title="Mapa en vivo">
              <div style={{ padding: 12 }}>
                <AnalyticsMap markers={markers} height={420} live />
                {markers.length === 0 && (
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 8 }}>Visitantes activos sin coordenadas (dev local). En producción Vercel agrega la ubicación.</p>
                )}
              </div>
            </CardNew>

            <CardNew noPad title="Visitantes activos">
              <div style={{ overflowX: "auto" }}>
                <table className="table-new">
                  <thead>
                    <tr>
                      <th>Quién</th>
                      <th>Página</th>
                      <th>Ubicación</th>
                      <th>Dispositivo</th>
                      <th style={{ textAlign: "right" }}>Págs</th>
                      <th style={{ textAlign: "right" }}>Visto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.visitors ?? []).map((v) => (
                      <tr key={v.sid}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ color: "var(--text-1)" }}>{v.clinicName || v.email || "Anónimo"}</span>
                            <Chip tone={v.identityType === "staff" ? "good" : v.identityType === "patient" ? "brand" : "neutral"}>
                              {identityLabel(v.identityType)}
                            </Chip>
                            <Chip>{surfaceLabel(v.surface)}</Chip>
                          </div>
                        </td>
                        <td className="mono" style={{ color: "var(--text-2)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.path}>
                          {v.path}
                        </td>
                        <td style={{ color: "var(--text-2)" }}>
                          {v.country ? `${countryFlag(v.country)} ${v.city || countryName(v.country)}` : "—"}
                        </td>
                        <td style={{ color: "var(--text-3)" }}>
                          {[v.device, v.browser].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>{formatNumber(v.pageviews)}</td>
                        <td className="mono" style={{ textAlign: "right", color: "var(--text-3)" }}>{formatRelative(v.lastSeenAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardNew>
          </div>

          <CardNew title="Por país">
            <BarList
              items={(data?.countByCountry ?? []).map((c) => ({
                label: (
                  <span>
                    <span style={{ marginRight: 6 }}>{countryFlag(c.country)}</span>
                    {countryName(c.country)}
                  </span>
                ),
                value: c.count,
                display: formatNumber(c.count),
              }))}
              color={SERIES[2]}
            />
          </CardNew>
        </div>
      )}
    </div>
  );
}
