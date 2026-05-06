// Atom: PhasePill — chip que representa una fase ortodóntica (Alineación,
// Nivelación, ..., Retención). El estado visual cambia entre actual / pasado /
// futuro para que el rail completo de fases sea legible de un vistazo.

import { Pill } from "./Pill";
import { PHASE_LABELS, type OrthoPhaseKey } from "../types";

type PhaseStatus = "past" | "current" | "future";

export interface PhasePillProps {
  phase: OrthoPhaseKey;
  status?: PhaseStatus;
  size?: "xs" | "sm";
}

export function PhasePill({ phase, status = "future", size = "xs" }: PhasePillProps) {
  const color = status === "current" ? "violet" : status === "past" ? "emerald" : "slate";
  return (
    <Pill color={color} size={size}>
      {PHASE_LABELS[phase]}
    </Pill>
  );
}
