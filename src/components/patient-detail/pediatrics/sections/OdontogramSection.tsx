"use client";
// Pediatrics — sub-tab Odontograma. Spec: §1.8, §4.A.5

import { useState } from "react";
import { PediatricOdontogram } from "../odontogram/PediatricOdontogram";
import { ToothDrawer } from "../drawers/ToothDrawer";
import type { DentitionType } from "@/lib/pediatrics/dentition";
import type { SealantRow } from "@/types/pediatrics";

export interface OdontogramSectionProps {
  patientId: string;
  defaultView: DentitionType;
  sealants: SealantRow[];
}

export function OdontogramSection(props: OdontogramSectionProps) {
  const [selectedFdi, setSelectedFdi] = useState<number | null>(null);

  const toothStates: Parameters<typeof PediatricOdontogram>[0]["toothStates"] = {};
  for (const s of props.sealants) {
    if (!s.deletedAt) {
      toothStates![s.toothFdi] = { state: "erupted", hasSealant: s.retentionStatus === "completo" };
    }
  }

  return (
    <div className="pedi-section">
      <h2 className="pedi-section__title">Odontograma pediátrico</h2>
      <PediatricOdontogram
        defaultView={props.defaultView}
        toothStates={toothStates}
        onToothClick={(fdi) => setSelectedFdi(fdi)}
      />
      <ToothDrawer
        open={selectedFdi != null}
        onClose={() => setSelectedFdi(null)}
        patientId={props.patientId}
        fdi={selectedFdi}
      />
    </div>
  );
}
