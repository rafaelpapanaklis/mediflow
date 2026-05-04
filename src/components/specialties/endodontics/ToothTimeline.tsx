"use client";
// Endodontics — ToothTimeline placeholder. Implementación completa en C13.

import type {
  EndodonticDiagnosisRow,
  EndodonticTreatmentFull,
  VitalityTestRow,
} from "@/lib/types/endodontics";

export interface ToothTimelineProps {
  diagnosis: EndodonticDiagnosisRow | null;
  activeTreatment: EndodonticTreatmentFull | null;
  pastTreatments: EndodonticTreatmentFull[];
  recentVitality: VitalityTestRow[];
  onClickEvent: (id: string, kind: string) => void;
}

export function ToothTimeline(_props: ToothTimelineProps) {
  return (
    <section className="endo-section endo-tooth-timeline">
      <p className="endo-section__placeholder">Tooth timeline — implementación en C13.</p>
    </section>
  );
}
