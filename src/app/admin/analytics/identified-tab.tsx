"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { StatTile, LoadingState, ErrorState, EmptyState, Chip } from "./ui";
import { formatNumber, formatRelative, identityLabel } from "@/lib/analytics/format";
import type { IdentifiedResponse } from "@/lib/analytics/types";
import type { TabProps } from "./analytics-client";

export function IdentifiedTab({ query, onClinicSelect }: TabProps) {
  const [data, setData] = useState<IdentifiedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/analytics?section=identified&${query}`, { signal: ctrl.signal })
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
  if (!data || data.clinics.length === 0)
    return (
      <CardNew>
        <EmptyState
          icon="🏥"
          title="Sin visitas de registrados"
          hint="Cuando una clínica o usuario con sesión iniciada visite el sitio o el panel, aquí verás quién es, cuánto navega y dónde."
        />
      </CardNew>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <StatTile label="Clínicas identificadas" value={formatNumber(data.totalIdentifiedClinics)} />
        <StatTile label="Visitas identificadas" value={formatNumber(data.totalIdentifiedVisits)} tone="good" />
      </div>

      <CardNew noPad title="Clínicas y usuarios registrados" sub="Quién de tus registrados visita el sitio y el panel. Click en una fila para filtrar todo por esa clínica.">
        <div style={{ overflowX: "auto" }}>
          <table className="table-new">
            <thead>
              <tr>
                <th>Clínica / usuario</th>
                <th>Plan</th>
                <th>Tipo</th>
                <th style={{ textAlign: "right" }}>Visitas</th>
                <th style={{ textAlign: "right" }}>Sitio web</th>
                <th style={{ textAlign: "right" }}>Panel</th>
                <th style={{ textAlign: "right" }}>Usuarios</th>
                <th style={{ textAlign: "right" }}>Última visita</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.clinics.map((c, i) => {
                const clickable = !!c.clinicId && !!onClinicSelect;
                return (
                  <tr
                    key={c.clinicId || `row-${i}`}
                    onClick={clickable ? () => onClinicSelect!(c.clinicId!, c.clinicName || "Clínica") : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onClinicSelect!(c.clinicId!, c.clinicName || "Clínica");
                            }
                          }
                        : undefined
                    }
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    style={{ cursor: clickable ? "pointer" : "default" }}
                  >
                    <td style={{ color: "var(--text-1)", fontWeight: 500 }}>
                      {c.clinicName}
                      {c.emails.length > 0 && (
                        <div style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>
                          {c.emails.join(", ")}
                        </div>
                      )}
                    </td>
                    <td>{c.plan ? <BadgeNew tone="brand">{c.plan}</BadgeNew> : <span style={{ color: "var(--text-3)" }}>—</span>}</td>
                    <td>
                      <Chip tone={c.identityType === "staff" ? "good" : "neutral"}>{identityLabel(c.identityType)}</Chip>
                    </td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-1)", fontWeight: 500 }}>{formatNumber(c.visits)}</td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>{formatNumber(c.publicVisits)}</td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-2)" }}>{formatNumber(c.dashboardVisits)}</td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-3)" }}>{formatNumber(c.distinctUsers)}</td>
                    <td className="mono" style={{ textAlign: "right", color: "var(--text-3)" }}>{formatRelative(c.lastSeenAt)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-3)" }}>{clickable && <ChevronRight size={14} strokeWidth={1.75} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardNew>
    </div>
  );
}
