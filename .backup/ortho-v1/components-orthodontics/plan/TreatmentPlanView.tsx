"use client";
// Orthodontics — vista del plan + timeline. SPEC §6.6.

import type { OrthodonticTreatmentPlanRow, OrthodonticPhaseRow } from "@/lib/types/orthodontics";
import type { OrthoPhaseKey } from "@prisma/client";
import { PhaseTimeline } from "./PhaseTimeline";

export interface TreatmentPlanViewProps {
  plan: OrthodonticTreatmentPlanRow;
  phases: OrthodonticPhaseRow[];
  monthInTreatment: number;
  onAdvance?: (toPhase: OrthoPhaseKey) => void;
  isAdvancing?: boolean;
}

export function TreatmentPlanView(props: TreatmentPlanViewProps) {
  const p = props.plan;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section
        style={{
          padding: 14,
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <Kpi label="Técnica" value={prettyTechnique(p.technique)} />
        <Kpi
          label="Duración"
          value={`${p.estimatedDurationMonths} meses`}
        />
        <Kpi
          label="Mes actual"
          value={`${props.monthInTreatment} / ${p.estimatedDurationMonths}`}
        />
        <Kpi label="Costo total" value={`$${Number(p.totalCostMxn).toLocaleString("es-MX")}`} />
        <Kpi label="Anclaje" value={p.anchorageType.toLowerCase()} />
        <Kpi label="Estado" value={p.status.replace("_", " ").toLowerCase()} />
      </section>

      {p.extractionsRequired ? (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(245,158,11,0.10)",
            border: "1px solid rgba(245,158,11,0.40)",
            borderRadius: 6,
            fontSize: 12,
            color: "#F59E0B",
          }}
        >
          Extracciones planificadas: FDI {p.extractionsTeethFdi.join(", ") || "—"}
        </div>
      ) : null}

      <section>
        <h4 style={{ margin: "0 0 8px", fontSize: 11, textTransform: "uppercase", color: "var(--text-2)" }}>
          Fases (orden lineal)
        </h4>
        <PhaseTimeline
          phases={props.phases}
          onAdvance={props.onAdvance}
          isAdvancing={props.isAdvancing}
        />
      </section>

      {p.retentionPlanText ? (
        <section
          style={{
            padding: 14,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <h4 style={{ margin: "0 0 6px", fontSize: 11, textTransform: "uppercase", color: "var(--text-2)" }}>
            Plan de retención
          </h4>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-1)", lineHeight: 1.5 }}>
            {p.retentionPlanText}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Kpi(props: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-3)", letterSpacing: 0.4 }}>
        {props.label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)", textTransform: "capitalize" }}>
        {props.value}
      </span>
    </div>
  );
}

function prettyTechnique(t: string): string {
  return t.replaceAll("_", " ").toLowerCase();
}
