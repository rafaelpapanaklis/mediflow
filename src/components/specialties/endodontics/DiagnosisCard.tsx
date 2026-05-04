"use client";
// Endodontics — DiagnosisCard placeholder. Implementación completa en C12.

import type {
  EndodonticDiagnosisRow,
  VitalityTestRow,
} from "@/lib/types/endodontics";

export interface DiagnosisCardProps {
  toothFdi: number;
  diagnosis: EndodonticDiagnosisRow | null;
  recentVitality: VitalityTestRow[];
  onCaptureDiagnosis: () => void;
  onCaptureVitality: () => void;
}

export function DiagnosisCard(_props: DiagnosisCardProps) {
  return (
    <section className="endo-section endo-diagnosis-card">
      <p className="endo-section__placeholder">Diagnosis card — implementación en C12.</p>
    </section>
  );
}
