"use client";
// Periodontics — header con BoP%, plaque%, distribución por bolsa.
// SPEC §6.6.

import type { PerioMetrics } from "@/lib/periodontics/periodontogram-math";

export function LiveIndicators({ metrics }: { metrics: PerioMetrics }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, minmax(96px, 1fr))",
        gap: 8,
        padding: "8px 12px",
        background: "var(--bg-elev, #0f1320)",
        borderRadius: 8,
        border: "1px solid var(--border, #1f2937)",
      }}
      data-testid="perio-live-indicators"
    >
      <Indicator label="BoP" value={`${metrics.bopPct}%`} hint="Sangrado al sondaje" />
      <Indicator label="Plaque" value={`${metrics.plaquePct}%`} hint="Índice O'Leary" />
      <Indicator
        label="1-3 mm"
        value={String(metrics.sites1to3)}
        hint="Sitios sanos"
      />
      <Indicator
        label="4-5 mm"
        value={String(metrics.sites4to5)}
        hint="Sitios moderados"
        tone="warning"
      />
      <Indicator
        label="≥6 mm"
        value={String(metrics.sites6plus)}
        hint="Sitios profundos"
        tone="danger"
      />
      <Indicator
        label="Bolsas ≥5 mm"
        value={String(metrics.teethWithPockets5plus)}
        hint="Dientes afectados"
      />
    </div>
  );
}

function Indicator({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "warning" | "danger";
}) {
  const valueColor =
    tone === "danger"
      ? "var(--danger, #ef4444)"
      : tone === "warning"
        ? "var(--warning, #eab308)"
        : "var(--text-1, #e5e7eb)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, color: "var(--text-2, #94a3b8)", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, color: valueColor }}>{value}</span>
      <span style={{ fontSize: 9, color: "var(--text-3, #64748b)" }}>{hint}</span>
    </div>
  );
}
