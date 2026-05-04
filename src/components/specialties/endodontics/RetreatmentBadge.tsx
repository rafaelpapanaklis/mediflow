"use client";
// Endodontics — badge visual para indicar que el TC actual es un
// retratamiento. Spec §6.13

import { RotateCcw } from "lucide-react";

export interface RetreatmentBadgeProps {
  failureReason?: string | null;
  difficulty?: string | null;
}

const FAILURE_LABEL: Record<string, string> = {
  FILTRACION_CORONAL: "Filtración coronal",
  INSTRUMENTO_FRACTURADO: "Instrumento fracturado",
  CONDUCTO_NO_TRATADO: "Conducto no tratado",
  SOBREOBTURACION: "Sobreobturación previa",
  SUBOBTURACION: "Subobturación previa",
  FRACTURA_RADICULAR: "Fractura radicular",
  REINFECCION: "Reinfección",
  DESCONOCIDO: "Causa desconocida",
};

const DIFFICULTY_LABEL: Record<string, string> = {
  BAJA: "Baja",
  MEDIA: "Media",
  ALTA: "Alta",
};

export function RetreatmentBadge(props: RetreatmentBadgeProps) {
  const reason = props.failureReason ? FAILURE_LABEL[props.failureReason] ?? props.failureReason : null;
  const difficulty = props.difficulty ? DIFFICULTY_LABEL[props.difficulty] ?? props.difficulty : null;
  return (
    <span className="endo-retreatment-badge" role="note" aria-label="Tratamiento es un retratamiento">
      <RotateCcw size={12} aria-hidden />
      <span className="endo-retreatment-badge__label">Retratamiento</span>
      {reason ? <span className="endo-retreatment-badge__reason">· {reason}</span> : null}
      {difficulty ? <span className="endo-retreatment-badge__difficulty">· dificultad {difficulty}</span> : null}
    </span>
  );
}
