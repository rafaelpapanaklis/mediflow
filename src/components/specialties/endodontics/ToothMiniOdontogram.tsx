"use client";
// Endodontics — odontograma miniatura del panel izquierdo (280px). Spec §6.3

import type { EndoToothSummary } from "@/lib/types/endodontics";

const FDI_UPPER_RIGHT = [18, 17, 16, 15, 14, 13, 12, 11];
const FDI_UPPER_LEFT = [21, 22, 23, 24, 25, 26, 27, 28];
const FDI_LOWER_LEFT = [38, 37, 36, 35, 34, 33, 32, 31];
const FDI_LOWER_RIGHT = [41, 42, 43, 44, 45, 46, 47, 48];

export type EndoToothState =
  | "none"
  | "tc_exitoso"
  | "tc_seguimiento"
  | "tc_alerta"
  | "tc_fracaso"
  | "tc_en_curso"
  | "cirugia";

const STATE_COLORS: Record<EndoToothState, string> = {
  none: "var(--text-3)",
  tc_exitoso: "var(--success)",
  tc_seguimiento: "var(--warning)",
  tc_alerta: "#FB923C",
  tc_fracaso: "var(--danger)",
  tc_en_curso: "var(--info)",
  cirugia: "#A78BFA",
};

const STATE_LABELS: Record<EndoToothState, string> = {
  none: "Sin TC",
  tc_exitoso: "TC exitoso",
  tc_seguimiento: "En seguimiento",
  tc_alerta: "Alerta",
  tc_fracaso: "Fracaso / retratamiento",
  tc_en_curso: "TC en curso",
  cirugia: "Cirugía apical",
};

export interface ToothMiniOdontogramProps {
  summaries: EndoToothSummary[];
  selectedFdi: number | null;
  onSelect: (fdi: number) => void;
}

export function ToothMiniOdontogram({
  summaries,
  selectedFdi,
  onSelect,
}: ToothMiniOdontogramProps) {
  const byFdi = new Map<number, EndoToothSummary>();
  for (const s of summaries) byFdi.set(s.fdi, s);

  return (
    <aside
      className="endo-mini-odo"
      aria-label="Estado endodóntico por diente"
    >
      <header className="endo-mini-odo__header">
        <h3>Estado endodóntico</h3>
        <p>Haz clic en un diente.</p>
      </header>

      <div className="endo-mini-odo__rows">
        <Row fdis={[...FDI_UPPER_RIGHT, ...FDI_UPPER_LEFT]}
             byFdi={byFdi}
             selectedFdi={selectedFdi}
             onSelect={onSelect} />
        <div className="endo-mini-odo__separator" aria-hidden />
        <Row fdis={[...FDI_LOWER_RIGHT, ...FDI_LOWER_LEFT]}
             byFdi={byFdi}
             selectedFdi={selectedFdi}
             onSelect={onSelect} />
      </div>

      <ul className="endo-mini-odo__legend">
        {(Object.keys(STATE_LABELS) as EndoToothState[]).map((k) => (
          <li key={k}>
            <span className="endo-mini-odo__swatch" style={{ background: STATE_COLORS[k] }} aria-hidden />
            {STATE_LABELS[k]}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Row(props: {
  fdis: number[];
  byFdi: Map<number, EndoToothSummary>;
  selectedFdi: number | null;
  onSelect: (fdi: number) => void;
}) {
  return (
    <div className="endo-mini-odo__row">
      {props.fdis.map((fdi) => {
        const summary = props.byFdi.get(fdi);
        const state = computeState(summary);
        const isActive = props.selectedFdi === fdi;
        return (
          <button
            key={fdi}
            type="button"
            onClick={() => props.onSelect(fdi)}
            className={`endo-mini-odo__tooth ${isActive ? "is-active" : ""}`}
            aria-pressed={isActive}
            aria-label={`Diente ${fdi} — ${STATE_LABELS[state]}`}
            title={`${fdi} · ${STATE_LABELS[state]}`}
          >
            <span
              className="endo-mini-odo__dot"
              style={{ background: STATE_COLORS[state] }}
              aria-hidden
            />
            <span className="endo-mini-odo__fdi">{fdi}</span>
          </button>
        );
      })}
    </div>
  );
}

function computeState(s: EndoToothSummary | undefined): EndoToothState {
  if (!s) return "none";
  if (!s.hasActiveTreatment && s.treatmentsCount === 0) return "none";
  if (s.outcomeStatus === "FALLIDO") return "tc_fracaso";
  if (s.outcomeStatus === "EN_CURSO") return "tc_en_curso";
  if (s.hasPendingFollowUp) return "tc_seguimiento";
  if (s.hasPendingRestoration) return "tc_alerta";
  if (s.outcomeStatus === "COMPLETADO") return "tc_exitoso";
  return "none";
}
