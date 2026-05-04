"use client";
// Endodontics — CanalMap placeholder. Implementación completa en C12.

import type { CanalSvgArchetype, RootCanalRow } from "@/lib/types/endodontics";

export interface CanalMapProps {
  toothFdi: number;
  archetype: CanalSvgArchetype;
  canals: RootCanalRow[];
  hasActiveTreatment: boolean;
  onCanalClick: (canalId: string) => void;
  onStartTreatment: () => void;
  onContinueTreatment?: () => void;
}

export function CanalMap(_props: CanalMapProps) {
  return (
    <section className="endo-section endo-canal-map">
      <p className="endo-section__placeholder">Canal map — implementación en C12.</p>
    </section>
  );
}
