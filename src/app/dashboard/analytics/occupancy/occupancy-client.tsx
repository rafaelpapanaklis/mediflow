"use client";

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";
import { AnalyticsLayout } from "@/components/dashboard/analytics/analytics-layout";
import { AnalyticsHeatmap, type HeatmapCell } from "@/components/dashboard/analytics/analytics-heatmap";
import { useT } from "@/i18n/i18n-provider";

interface Resource { id: string; name: string }
interface Doctor { id: string; firstName: string; lastName: string }

interface Props {
  resources: Resource[];
  doctors: Doctor[];
}

interface OccupancyData {
  heatmap: HeatmapCell[][];
  hours: number[];
  weeks: number;
  totalChairs: number;
  insights: {
    leastUsedResource: { id: string; name: string; pct: number } | null;
    totalAppts: number;
  };
}

const PRESETS = [
  { id: "7d",  labelKey: "analytics.occupancy.preset7d",  days: 7  },
  { id: "30d", labelKey: "analytics.occupancy.preset30d", days: 30 },
  { id: "90d", labelKey: "analytics.occupancy.preset90d", days: 90 },
];

export function OccupancyClient({ resources, doctors }: Props) {
  const t = useT();
  const [preset, setPreset] = useState("30d");
  const [resourceId, setResourceId] = useState<string>("");
  const [doctorId, setDoctorId] = useState<string>("");
  const [data, setData] = useState<OccupancyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const days = PRESETS.find((p) => p.id === preset)?.days ?? 30;
    const to = new Date().toISOString();
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({ from, to });
    if (resourceId) params.set("resourceId", resourceId);
    if (doctorId) params.set("doctorId", doctorId);
    fetch(`/api/analytics/occupancy?${params}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d as OccupancyData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => ctrl.abort();
  }, [preset, resourceId, doctorId]);

  return (
    <AnalyticsLayout
      title={t("analytics.occupancy.title")}
      subtitle={t("analytics.occupancy.subtitle")}
      rightActions={
        <div style={{ display: "flex", gap: 6 }}>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: preset === p.id ? "var(--brand)" : "var(--bg-elev)",
                color: preset === p.id ? "#fff" : "var(--text-2)",
                border: `1px solid ${preset === p.id ? "var(--brand)" : "var(--border-soft)"}`,
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
      }
    >
      {/* Filtros */}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <FilterSelect
          label={t("analytics.occupancy.chairFilter")}
          value={resourceId}
          onChange={setResourceId}
          options={[{ id: "", label: t("common.all") }, ...resources.map((r) => ({ id: r.id, label: r.name }))]}
        />
        <FilterSelect
          label={t("analytics.occupancy.doctorFilter")}
          value={doctorId}
          onChange={setDoctorId}
          options={[
            { id: "", label: t("common.all") },
            ...doctors.map((d) => ({ id: d.id, label: `${d.firstName} ${d.lastName}` })),
          ]}
        />
      </div>

      {loading ? (
        <div
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 14,
            padding: 60,
            textAlign: "center",
            color: "var(--text-3)",
            fontSize: 13,
          }}
        >
          {t("analytics.occupancy.calculatingHeatmap")}
        </div>
      ) : !data ? (
        <div
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 14,
            padding: 60,
            textAlign: "center",
            color: "var(--text-3)",
            fontSize: 13,
          }}
        >
          {t("analytics.occupancy.noData")}
        </div>
      ) : (
        <>
          <AnalyticsHeatmap data={data.heatmap} hours={data.hours} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
            <Stat label={t("analytics.occupancy.apptsInRange")} value={data.insights.totalAppts.toLocaleString("es-MX")} />
            <Stat label={t("analytics.occupancy.activeChairs")} value={String(data.totalChairs)} />
          </div>

          {data.insights.leastUsedResource && (
            <div
              style={{
                marginTop: 14,
                padding: 14,
                background: "rgba(217, 119, 6, 0.08)",
                border: "1px solid rgba(217, 119, 6, 0.25)",
                borderRadius: 10,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                fontSize: 13,
                color: "var(--text-2)",
              }}
            >
              <div style={{ color: "#d97706", flexShrink: 0, marginTop: 2 }}>
                <Lightbulb size={16} aria-hidden />
              </div>
              <div>
                <strong style={{ color: "var(--text-1)" }}>{data.insights.leastUsedResource.name}</strong>{" "}
                {t("analytics.occupancy.leastUsedHint", { pct: data.insights.leastUsedResource.pct })}
              </div>
            </div>
          )}
        </>
      )}
    </AnalyticsLayout>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "var(--bg-elev)",
          color: "var(--text-1)",
          border: "1px solid var(--border-soft)",
          borderRadius: 8,
          padding: "7px 10px",
          fontSize: 12,
          fontFamily: "inherit",
          minWidth: 160,
        }}
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}
