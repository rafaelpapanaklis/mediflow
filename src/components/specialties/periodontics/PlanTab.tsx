"use client";
// Periodontics — sub-tab Plan: PhaseProgress + QuadrantMap + PlanTimeline.
// SPEC §6.1.

const PHASES: { key: "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4"; label: string; description: string }[] = [
  { key: "PHASE_1", label: "Fase 1", description: "Control sistémico + higiene profesional + control de placa." },
  { key: "PHASE_2", label: "Fase 2", description: "Raspado y alisado radicular por cuadrante o boca completa." },
  { key: "PHASE_3", label: "Fase 3", description: "Reevaluación y cirugía periodontal en sitios residuales." },
  { key: "PHASE_4", label: "Fase 4", description: "Mantenimiento periodontal a largo plazo." },
];

export interface PlanTabProps {
  currentPhase?: "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4" | null;
  phaseDates?: Partial<
    Record<
      | "phase1StartedAt"
      | "phase1CompletedAt"
      | "phase2StartedAt"
      | "phase2CompletedAt"
      | "phase3StartedAt"
      | "phase3CompletedAt"
      | "phase4StartedAt",
      string | null
    >
  >;
  quadrantStatus?: Record<"Q1" | "Q2" | "Q3" | "Q4", { completed: boolean; completedAt?: string | null }>;
  timeline?: Array<{ date: string; label: string }>;
  onAdvance?: (toPhase: "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4") => void;
}

export function PlanTab(props: PlanTabProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PhaseProgress
        currentPhase={props.currentPhase ?? null}
        dates={props.phaseDates ?? {}}
        onAdvance={props.onAdvance}
      />

      <QuadrantMap status={props.quadrantStatus} />

      <Timeline events={props.timeline ?? []} />
    </div>
  );
}

function PhaseProgress(props: {
  currentPhase: "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4" | null;
  dates: NonNullable<PlanTabProps["phaseDates"]>;
  onAdvance?: PlanTabProps["onAdvance"];
}) {
  const currentIdx = PHASES.findIndex((p) => p.key === props.currentPhase);

  return (
    <section
      style={{
        padding: 16,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-2)", margin: 0, marginBottom: 12 }}>
        Progreso por fases
      </h3>
      <div style={{ display: "flex", gap: 8 }}>
        {PHASES.map((phase, i) => {
          const isCompleted = currentIdx > i;
          const isCurrent = currentIdx === i;
          const tone = isCompleted ? "success" : isCurrent ? "warning" : "neutral";
          const bg =
            tone === "success"
              ? "var(--success-soft, rgba(34,197,94,0.12))"
              : tone === "warning"
                ? "var(--warning-soft, rgba(234,179,8,0.12))"
                : "var(--bg, #0b0d11)";
          return (
            <div
              key={phase.key}
              style={{
                flex: 1,
                padding: 12,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: bg,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
                {phase.label}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
                {phase.description}
              </div>
              {isCurrent && props.onAdvance && i < PHASES.length - 1 ? (
                <button
                  type="button"
                  onClick={() => props.onAdvance!(PHASES[i + 1]!.key)}
                  style={{
                    marginTop: 8,
                    padding: "5px 10px",
                    fontSize: 10,
                    border: "1px solid var(--brand)",
                    borderRadius: 4,
                    background: "transparent",
                    color: "var(--brand)",
                    cursor: "pointer",
                  }}
                >
                  Avanzar a {PHASES[i + 1]!.label}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function QuadrantMap(props: { status?: PlanTabProps["quadrantStatus"] }) {
  const quads: Array<"Q1" | "Q2" | "Q3" | "Q4"> = ["Q1", "Q2", "Q3", "Q4"];
  return (
    <section
      style={{
        padding: 16,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-2)", margin: 0, marginBottom: 12 }}>
        Cuadrantes (SRP)
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {quads.map((q) => {
          const s = props.status?.[q];
          return (
            <div
              key={q}
              style={{
                padding: 10,
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: s?.completed
                  ? "var(--success-soft, rgba(34,197,94,0.12))"
                  : "var(--bg, #0b0d11)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
                {q} {s?.completed ? "·  ✓" : ""}
              </div>
              {s?.completedAt ? (
                <div style={{ fontSize: 10, color: "var(--text-3)" }}>{s.completedAt}</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Timeline(props: { events: Array<{ date: string; label: string }> }) {
  return (
    <section
      style={{
        padding: 16,
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 8,
      }}
    >
      <h3 style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-2)", margin: 0, marginBottom: 12 }}>
        Línea de tiempo
      </h3>
      {props.events.length === 0 ? (
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>Sin eventos registrados.</span>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {props.events.map((e, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                gap: 12,
                padding: "6px 0",
                borderBottom: i < props.events.length - 1 ? "1px solid var(--border)" : undefined,
              }}
            >
              <span style={{ fontSize: 11, color: "var(--text-3)", minWidth: 80, fontFamily: "monospace" }}>
                {e.date}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-1)" }}>{e.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
