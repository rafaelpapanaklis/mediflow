"use client";
// Endodontics — vista diente-céntrica: 3 secciones verticales. Spec §1.1, §6.1

import type { ToothCenterViewData } from "@/lib/types/endodontics";
import { DiagnosisCard } from "./DiagnosisCard";
import { CanalMap } from "./CanalMap";
import { ToothTimeline } from "./ToothTimeline";

export interface ToothCenterViewProps {
  data: ToothCenterViewData;
  onStartTreatment: () => void;
  onContinueTreatment: (treatmentId: string) => void;
  onCaptureDiagnosis: () => void;
  onCaptureVitality: () => void;
  onClickCanal: (canalId: string) => void;
  onClickTimelineEvent: (id: string, kind: string) => void;
}

export function ToothCenterView(props: ToothCenterViewProps) {
  const { data } = props;

  return (
    <div className="endo-center">
      <DiagnosisCard
        toothFdi={data.toothFdi}
        diagnosis={data.diagnosis}
        recentVitality={data.recentVitality}
        onCaptureDiagnosis={props.onCaptureDiagnosis}
        onCaptureVitality={props.onCaptureVitality}
      />

      <CanalMap
        toothFdi={data.toothFdi}
        archetype={data.archetype}
        canals={data.activeTreatment?.rootCanals ?? []}
        hasActiveTreatment={data.activeTreatment !== null}
        onCanalClick={props.onClickCanal}
        onStartTreatment={props.onStartTreatment}
        onContinueTreatment={
          data.activeTreatment ? () => props.onContinueTreatment(data.activeTreatment!.id) : undefined
        }
      />

      <ToothTimeline
        diagnosis={data.diagnosis}
        activeTreatment={data.activeTreatment}
        pastTreatments={data.pastTreatments}
        recentVitality={data.recentVitality}
        onClickEvent={props.onClickTimelineEvent}
      />
    </div>
  );
}
