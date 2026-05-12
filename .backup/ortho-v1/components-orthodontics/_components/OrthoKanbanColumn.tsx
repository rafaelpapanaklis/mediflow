"use client";
// Orthodontics — columna del kanban con header + cards + banner truncado. SPEC §6.2.

import type { OrthoKanbanCard } from "@/lib/types/orthodontics";
import type { OrthoPhaseKey } from "@prisma/client";
import { PHASE_LABELS } from "@/lib/orthodontics/kanban-helpers";
import { OrthoPatientCard } from "./OrthoPatientCard";

export interface OrthoKanbanColumnProps {
  phaseKey: OrthoPhaseKey;
  cards: OrthoKanbanCard[];
  totalCount: number;
  truncatedCount: number;
}

export function OrthoKanbanColumn(props: OrthoKanbanColumnProps) {
  return (
    <div
      style={{
        flex: "0 0 280px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: "var(--bg)",
        borderRadius: 8,
        padding: 8,
        maxHeight: "100%",
      }}
    >
      <header
        style={{
          padding: "6px 8px 4px",
          borderBottom: "1px solid var(--border)",
          marginBottom: 4,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "var(--text-2)",
              fontWeight: 700,
            }}
          >
            {PHASE_LABELS[props.phaseKey]}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {props.totalCount}
          </span>
        </div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
        {props.cards.length === 0 ? (
          <div
            style={{
              padding: "24px 8px",
              textAlign: "center",
              fontSize: 11,
              color: "var(--text-3)",
            }}
          >
            Sin pacientes en esta fase
          </div>
        ) : (
          props.cards.map((c) => <OrthoPatientCard key={c.treatmentPlanId} card={c} />)
        )}
      </div>

      {props.truncatedCount > 0 ? (
        <div
          style={{
            padding: "8px 10px",
            background: "rgba(59,130,246,0.10)",
            border: "1px solid rgba(59,130,246,0.40)",
            borderRadius: 6,
            fontSize: 11,
            color: "#3B82F6",
            textAlign: "center",
          }}
        >
          {props.truncatedCount} pacientes adicionales — usa filtros para ver detalle.
        </div>
      ) : null}
    </div>
  );
}
