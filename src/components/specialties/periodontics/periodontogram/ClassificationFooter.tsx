"use client";
// Periodontics — footer con la clasificación 2017 + extension. SPEC §6.7.

export interface ClassificationFooterProps {
  stage?: string | null;
  grade?: string | null;
  extension?: string | null;
  overridden?: boolean;
  onClassify?: () => void;
  onOverride?: () => void;
  isClassifying?: boolean;
}

const STAGE_LABEL: Record<string, string> = {
  SALUD: "Salud periodontal",
  GINGIVITIS: "Gingivitis",
  STAGE_I: "Estadio I",
  STAGE_II: "Estadio II",
  STAGE_III: "Estadio III",
  STAGE_IV: "Estadio IV",
};
const GRADE_LABEL: Record<string, string> = {
  GRADE_A: "Grado A",
  GRADE_B: "Grado B",
  GRADE_C: "Grado C",
};
const EXT_LABEL: Record<string, string> = {
  LOCALIZADA: "Localizada",
  GENERALIZADA: "Generalizada",
  PATRON_MOLAR_INCISIVO: "Patrón molar/incisivo",
};

export function ClassificationFooter(props: ClassificationFooterProps) {
  const stage = props.stage ? STAGE_LABEL[props.stage] ?? props.stage : null;
  const grade = props.grade ? GRADE_LABEL[props.grade] ?? props.grade : null;
  const ext = props.extension ? EXT_LABEL[props.extension] ?? props.extension : null;

  const tone = !stage
    ? "neutral"
    : stage.startsWith("Estadio III") || stage.startsWith("Estadio IV")
      ? "danger"
      : stage === "Gingivitis" || stage.startsWith("Estadio I")
        ? "warning"
        : "success";
  const bg =
    tone === "danger"
      ? "var(--danger-soft, rgba(239,68,68,0.12))"
      : tone === "warning"
        ? "var(--warning-soft, rgba(234,179,8,0.12))"
        : tone === "success"
          ? "var(--success-soft, rgba(34,197,94,0.12))"
          : "var(--bg-elev, #11151c)";
  const labelColor =
    tone === "danger"
      ? "var(--danger, #ef4444)"
      : tone === "warning"
        ? "var(--warning, #eab308)"
        : tone === "success"
          ? "var(--success, #22c55e)"
          : "var(--text-1, #e5e7eb)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        background: bg,
        borderRadius: 8,
        border: "1px solid var(--border, #1f2937)",
      }}
      data-testid="perio-classification-footer"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 10, color: "var(--text-2, #94a3b8)", textTransform: "uppercase" }}>
          Clasificación 2017 AAP/EFP
        </span>
        {stage ? (
          <span style={{ fontSize: 16, fontWeight: 700, color: labelColor }}>
            {[stage, grade, ext].filter(Boolean).join(" · ")}
            {props.overridden ? (
              <span
                style={{
                  fontSize: 10,
                  marginLeft: 8,
                  padding: "2px 6px",
                  borderRadius: 3,
                  background: "var(--brand-soft, rgba(99,102,241,0.18))",
                  color: "var(--brand, #6366f1)",
                  textTransform: "uppercase",
                }}
              >
                Sobrescrita
              </span>
            ) : null}
          </span>
        ) : (
          <span style={{ fontSize: 14, color: "var(--text-2, #94a3b8)" }}>
            Sin clasificar — completa el sondaje y clasifica al paciente.
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {props.onClassify ? (
          <button
            type="button"
            onClick={props.onClassify}
            disabled={props.isClassifying}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--brand, #6366f1)",
              background: "var(--brand, #6366f1)",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: props.isClassifying ? "wait" : "pointer",
              opacity: props.isClassifying ? 0.6 : 1,
            }}
          >
            {props.isClassifying ? "Calculando..." : stage ? "Reclasificar" : "Clasificar paciente"}
          </button>
        ) : null}
        {stage && props.onOverride ? (
          <button
            type="button"
            onClick={props.onOverride}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--border, #1f2937)",
              background: "transparent",
              color: "var(--text-1, #e5e7eb)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Sobrescribir
          </button>
        ) : null}
      </div>
    </div>
  );
}
