"use client";
// Periodontics — lista de pacientes con sondaje reciente. SPEC §6.

import Link from "next/link";

export interface PerioPatientRow {
  id: string;
  name: string;
  lastRecordAt?: string | null;
  classificationStage?: string | null;
  riskCategory?: "BAJO" | "MODERADO" | "ALTO" | null;
  bopPct?: number | null;
}

export function PerioPatientList(props: { patients: PerioPatientRow[] }) {
  if (props.patients.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-3)",
          background: "var(--bg-elev)",
          border: "1px dashed var(--border)",
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        Aún no hay pacientes con sondaje periodontal. Crea uno desde el expediente del paciente.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {props.patients.map((p) => (
        <Link
          key={p.id}
          href={`/dashboard/specialties/periodontics/${p.id}`}
          style={{
            display: "block",
            padding: 14,
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>{p.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
            {p.lastRecordAt ? `Último sondaje: ${p.lastRecordAt}` : "Sin sondajes"}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 8,
              flexWrap: "wrap",
            }}
          >
            {p.classificationStage ? (
              <Pill
                tone={
                  p.classificationStage.includes("STAGE_III") ||
                  p.classificationStage.includes("STAGE_IV")
                    ? "danger"
                    : p.classificationStage.includes("STAGE_I") ||
                        p.classificationStage.includes("GINGIVITIS")
                      ? "warning"
                      : "success"
                }
                label={p.classificationStage.replace("_", " ")}
              />
            ) : null}
            {p.riskCategory ? (
              <Pill
                tone={
                  p.riskCategory === "ALTO"
                    ? "danger"
                    : p.riskCategory === "MODERADO"
                      ? "warning"
                      : "success"
                }
                label={`Riesgo ${p.riskCategory.toLowerCase()}`}
              />
            ) : null}
            {p.bopPct != null ? <Pill tone="neutral" label={`BoP ${p.bopPct}%`} /> : null}
          </div>
        </Link>
      ))}
    </div>
  );
}

function Pill(props: { tone: "success" | "warning" | "danger" | "neutral"; label: string }) {
  const bg =
    props.tone === "success"
      ? "var(--success-soft, rgba(34,197,94,0.16))"
      : props.tone === "warning"
        ? "var(--warning-soft, rgba(234,179,8,0.16))"
        : props.tone === "danger"
          ? "var(--danger-soft, rgba(239,68,68,0.16))"
          : "var(--bg, #0b0d11)";
  const fg =
    props.tone === "success"
      ? "var(--success, #22c55e)"
      : props.tone === "warning"
        ? "var(--warning, #eab308)"
        : props.tone === "danger"
          ? "var(--danger, #ef4444)"
          : "var(--text-2, #94a3b8)";
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 4,
        background: bg,
        color: fg,
        textTransform: "uppercase",
      }}
    >
      {props.label}
    </span>
  );
}
