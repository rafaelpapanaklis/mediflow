"use client";

import { useEffect, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BarList, LoadingState, ErrorState, EmptyState, SERIES } from "./ui";
import { formatNumber, formatPct, referrerTypeLabel } from "@/lib/analytics/format";
import type { SourcesResponse, SourceRow } from "@/lib/analytics/types";
import type { TabProps } from "./analytics-client";

export function SourcesTab({ query }: TabProps) {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics?section=sources&${query}`, { signal: ctrl.signal })
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

  const totalVisits = data ? data.referrerTypes.reduce((s, r) => s + r.visits, 0) : 0;
  if (!data || totalVisits === 0)
    return (
      <CardNew>
        <EmptyState icon="🧭" title="Sin datos de origen" hint="Aquí verás de dónde llegan tus visitantes: buscadores, redes, publicidad, referencias y campañas UTM." />
      </CardNew>
    );

  const toItems = (rows: SourceRow[], label?: (k: string) => string) =>
    rows.map((r) => ({
      label: label ? label(r.key) : r.key,
      value: r.visits,
      display: formatNumber(r.visits),
      sub: `${formatNumber(r.visitors)} únicos · ${formatPct(r.bounceRate)} rebote`,
    }));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
      <CardNew title="Canales" sub="Cómo llegan los visitantes">
        <BarList items={toItems(data.referrerTypes, referrerTypeLabel)} color={SERIES[0]} />
      </CardNew>
      <CardNew title="Sitios de origen" sub="Dominios que refieren tráfico">
        <BarList items={toItems(data.referrers)} color={SERIES[1]} emptyLabel="Sin referrers (tráfico directo)" />
      </CardNew>
      <CardNew title="UTM source" sub="Fuente de campañas etiquetadas">
        <BarList items={toItems(data.utmSources)} color={SERIES[2]} emptyLabel="Sin UTMs registrados" />
      </CardNew>
      <CardNew title="Campañas UTM" sub="utm_campaign">
        <BarList items={toItems(data.utmCampaigns)} color={SERIES[3]} emptyLabel="Sin campañas etiquetadas" />
      </CardNew>
      <CardNew title="Páginas de entrada" sub="Primera página de cada visita">
        <BarList items={toItems(data.entryPages)} color={SERIES[4]} />
      </CardNew>
    </div>
  );
}
