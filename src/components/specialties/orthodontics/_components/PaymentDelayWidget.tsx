"use client";
// Orthodontics — widget de KPIs financieros encima del kanban. SPEC §6.2.

import type { PaymentDelaySummary } from "@/lib/types/orthodontics";

export function PaymentDelayWidget({ summary }: { summary: PaymentDelaySummary }) {
  const hasDelay = summary.lightDelayCount + summary.severeDelayCount > 0;
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 8,
        padding: "12px 14px",
        background: hasDelay
          ? "rgba(245,158,11,0.06)"
          : "var(--bg-elev)",
        border: hasDelay
          ? "1px solid rgba(245,158,11,0.40)"
          : "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <Kpi label="Tratamientos activos" value={summary.totalActivePlans} />
      <Kpi label="Al corriente" value={summary.onTimeCount} tone="success" />
      <Kpi label="Atraso leve" value={summary.lightDelayCount} tone="warning" />
      <Kpi label="Atraso severo" value={summary.severeDelayCount} tone="danger" />
      <Kpi
        label="Total adeudado"
        value={`$${summary.totalOverdueMxn.toLocaleString("es-MX")}`}
        tone={summary.totalOverdueMxn > 0 ? "danger" : "neutral"}
      />
    </section>
  );
}

function Kpi(props: {
  label: string;
  value: number | string;
  tone?: "success" | "warning" | "danger" | "neutral";
}) {
  const color =
    props.tone === "success"
      ? "#22C55E"
      : props.tone === "warning"
        ? "#F59E0B"
        : props.tone === "danger"
          ? "#EF4444"
          : "var(--text-1)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-3)", letterSpacing: 0.4 }}>
        {props.label}
      </span>
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{props.value}</span>
    </div>
  );
}
