"use client";

import { useEffect, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { LoadingState, ErrorState, EmptyState } from "./ui";
import { formatNumber, formatDuration, formatPct } from "@/lib/analytics/format";
import type { PagesResponse } from "@/lib/analytics/types";
import type { TabProps } from "./analytics-client";

export function PagesTab({ query }: TabProps) {
  const [data, setData] = useState<PagesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics?section=pages&${query}`, { signal: ctrl.signal })
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

  if (loading && !data) return <CardNew><LoadingState /></CardNew>;
  if (error) return <CardNew><ErrorState message={error} onRetry={() => setTick((t) => t + 1)} /></CardNew>;
  if (!data || data.pages.length === 0)
    return (
      <CardNew>
        <EmptyState icon="📄" title="Sin páginas registradas" hint="Aquí verás qué páginas se ven más, el tiempo medio en cada una, y sus tasas de entrada, salida y rebote." />
      </CardNew>
    );

  return (
    <CardNew noPad title="Páginas" sub="Ordenadas por páginas vistas (top 100)">
      <div style={{ overflowX: "auto" }}>
        <table className="table-new">
          <thead>
            <tr>
              <th>Ruta</th>
              <th style={{ textAlign: "right" }}>Vistas</th>
              <th style={{ textAlign: "right" }}>Visitantes</th>
              <th style={{ textAlign: "right" }}>T. medio</th>
              <th style={{ textAlign: "right" }}>Entradas</th>
              <th style={{ textAlign: "right" }}>Salidas</th>
              <th style={{ textAlign: "right" }}>Rebote</th>
            </tr>
          </thead>
          <tbody>
            {data.pages.map((p) => (
              <tr key={p.path}>
                <td className="mono" style={{ color: "var(--text-1)", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.path}>
                  {p.path}
                </td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-1)", fontWeight: 500 }}>{formatNumber(p.pageviews)}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>{formatNumber(p.visitors)}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>{formatDuration(p.avgDurationMs)}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-3)" }}>{formatNumber(p.entries)}</td>
                <td className="mono" style={{ textAlign: "right", color: "var(--text-3)" }}>{formatNumber(p.exits)}</td>
                <td
                  className="mono"
                  style={{ textAlign: "right", color: p.bounceRate > 60 ? "var(--danger)" : p.bounceRate < 40 ? "var(--success)" : "var(--text-2)" }}
                >
                  {formatPct(p.bounceRate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardNew>
  );
}
