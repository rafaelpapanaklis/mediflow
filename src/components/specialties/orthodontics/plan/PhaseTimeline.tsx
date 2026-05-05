"use client";
// Orthodontics — timeline vertical de las 6 fases. SPEC §6.6.

import type { OrthodonticPhaseRow } from "@/lib/types/orthodontics";
import type { OrthoPhaseKey } from "@prisma/client";
import { PHASE_LABELS } from "@/lib/orthodontics/kanban-helpers";

export interface PhaseTimelineProps {
  phases: OrthodonticPhaseRow[];
  onAdvance?: (toPhase: OrthoPhaseKey) => void;
  isAdvancing?: boolean;
}

export function PhaseTimeline(props: PhaseTimelineProps) {
  const sorted = [...props.phases].sort((a, b) => a.orderIndex - b.orderIndex);
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      {sorted.map((phase, idx) => {
        const next = sorted[idx + 1];
        const canAdvance =
          phase.status === "IN_PROGRESS" && next && next.status === "NOT_STARTED";
        return (
          <li
            key={phase.id}
            style={{
              display: "flex",
              gap: 12,
              padding: 12,
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <PhaseCircle status={phase.status} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                  {PHASE_LABELS[phase.phaseKey]}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  {phase.status === "IN_PROGRESS" ? "En curso" :
                    phase.status === "COMPLETED" ? "Completada" :
                    phase.status === "DELAYED" ? "Atrasada" : "Pendiente"}
                </span>
              </div>
              {phase.startedAt ? (
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  Inicio: {new Date(phase.startedAt).toLocaleDateString("es-MX")}
                  {phase.completedAt
                    ? ` · Cierre: ${new Date(phase.completedAt).toLocaleDateString("es-MX")}`
                    : phase.expectedEndAt
                      ? ` · Esperado: ${new Date(phase.expectedEndAt).toLocaleDateString("es-MX")}`
                      : ""}
                </div>
              ) : null}
              {phase.notes ? (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-2)" }}>
                  {phase.notes}
                </p>
              ) : null}
              {canAdvance && props.onAdvance && next ? (
                <button
                  type="button"
                  onClick={() => props.onAdvance!(next.phaseKey)}
                  disabled={props.isAdvancing}
                  style={{
                    marginTop: 8,
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: "1px solid var(--brand, #6366f1)",
                    background: "transparent",
                    color: "var(--brand, #6366f1)",
                    fontSize: 11,
                    cursor: props.isAdvancing ? "wait" : "pointer",
                    opacity: props.isAdvancing ? 0.6 : 1,
                  }}
                >
                  {props.isAdvancing ? "Avanzando..." : `Avanzar a ${PHASE_LABELS[next.phaseKey]}`}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PhaseCircle({ status }: { status: OrthodonticPhaseRow["status"] }) {
  const color =
    status === "COMPLETED"
      ? "#22C55E"
      : status === "IN_PROGRESS"
        ? "#3B82F6"
        : status === "DELAYED"
          ? "#F59E0B"
          : "var(--text-3)";
  return (
    <span
      aria-hidden
      style={{
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        marginTop: 4,
        boxShadow: status === "IN_PROGRESS" ? "0 0 0 4px rgba(59,130,246,0.20)" : "none",
      }}
    />
  );
}
