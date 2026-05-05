"use client";
// Orthodontics — wrapper client del OrthodonticsTab que cablea wizards/modales
// y dispara server actions. SPEC §6.

import { useState } from "react";
import toast from "react-hot-toast";
import type {
  OrthodonticDiagnosisRow,
  OrthodonticTreatmentPlanRow,
  OrthodonticPhaseRow,
  OrthoPaymentPlanRow,
  OrthoInstallmentRow,
  OrthoPhotoSetWithFiles,
  OrthodonticControlAppointmentRow,
  OrthodonticDigitalRecordRow,
} from "@/lib/types/orthodontics";
import type { OrthoPhaseKey, OrthoPhotoSetType } from "@prisma/client";
import { advanceTreatmentPhase, recalculatePaymentStatus } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import { availableSetTypes } from "@/lib/orthodontics/photo-set-helpers";
import { OrthodonticsTab } from "./OrthodonticsTab";
import { DiagnosisWizard } from "./diagnosis/DiagnosisWizard";
import { TreatmentPlanWizard } from "./plan/TreatmentPlanWizard";
import { PhotoSetWizard } from "./photos/PhotoSetWizard";
import { ControlAppointmentWizard } from "./controls/ControlAppointmentWizard";
import { RecordPaymentDrawer } from "./payments/RecordPaymentDrawer";
import { PhotoCompareSlider } from "./photos/PhotoCompareSlider";

export interface OrthodonticsClientProps {
  patientId: string;
  patientName: string;
  isMinor: boolean;
  pediatricsModuleActive?: boolean;
  hasPediatricProfile?: boolean;
  guardianName?: string | null;
  pediatricHabits?: readonly string[];

  diagnosis: OrthodonticDiagnosisRow | null;
  plan: OrthodonticTreatmentPlanRow | null;
  phases: OrthodonticPhaseRow[];
  monthInTreatment: number;
  paymentPlan: OrthoPaymentPlanRow | null;
  installments: OrthoInstallmentRow[];
  photoSets: OrthoPhotoSetWithFiles[];
  controls: OrthodonticControlAppointmentRow[];
  digitalRecords: OrthodonticDigitalRecordRow[];

  resolveFileUrl: (fileId: string) => string;
  agreementPdfHref?: string;
}

export function OrthodonticsClient(props: OrthodonticsClientProps) {
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<OrthoInstallmentRow | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const [advancing, setAdvancing] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const existingTypes = new Set<OrthoPhotoSetType>(
    props.photoSets.map((s) => s.setType),
  );
  const types = availableSetTypes(existingTypes);

  const handleAdvancePhase = async (toPhase: OrthoPhaseKey) => {
    if (!props.plan) return;
    setAdvancing(true);
    try {
      const result = await advanceTreatmentPhase({
        treatmentPlanId: props.plan.id,
        toPhase,
        notes: null,
      });
      if (isFailure(result)) {
        toast.error(result.error);
        return;
      }
      toast.success(`Fase avanzada a ${toPhase}`);
    } finally {
      setAdvancing(false);
    }
  };

  const handleRecalculate = async () => {
    if (!props.paymentPlan) return;
    setRecalculating(true);
    try {
      const result = await recalculatePaymentStatus({ paymentPlanId: props.paymentPlan.id });
      if (isFailure(result)) {
        toast.error(result.error);
        return;
      }
      toast.success(`Status: ${result.data.status}`);
    } finally {
      setRecalculating(false);
    }
  };

  const handleRecordPayment = (installmentId: string) => {
    const target = props.installments.find((i) => i.id === installmentId);
    if (target) setPaymentTarget(target);
  };

  // Comparativo: si hay T0 y T2, los usamos directo. Si solo T0, comparamos contra el último CONTROL/T1.
  const compareSets = (() => {
    const t0 = props.photoSets.find((s) => s.setType === "T0");
    const t2 = props.photoSets.find((s) => s.setType === "T2");
    const t1 = props.photoSets.find((s) => s.setType === "T1");
    const lastControl = props.photoSets
      .filter((s) => s.setType === "CONTROL")
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
    const before = t0;
    const after = t2 ?? t1 ?? lastControl;
    return before && after ? { before, after } : null;
  })();

  return (
    <>
      <OrthodonticsTab
        patientId={props.patientId}
        patientName={props.patientName}
        isMinor={props.isMinor}
        pediatricsModuleActive={props.pediatricsModuleActive}
        hasPediatricProfile={props.hasPediatricProfile}
        guardianName={props.guardianName}
        pediatricHabits={props.pediatricHabits}
        diagnosis={props.diagnosis}
        plan={props.plan}
        phases={props.phases}
        monthInTreatment={props.monthInTreatment}
        paymentPlan={props.paymentPlan}
        installments={props.installments}
        photoSets={props.photoSets}
        controls={props.controls}
        digitalRecords={props.digitalRecords}
        resolveFileUrl={props.resolveFileUrl}
        agreementPdfHref={props.agreementPdfHref}
        onStartDiagnosis={() => setDiagnosisOpen(true)}
        onEditDiagnosis={() => setDiagnosisOpen(true)}
        onCreatePlan={() => setPlanOpen(true)}
        onAdvancePhase={handleAdvancePhase}
        isAdvancingPhase={advancing}
        onCreatePhotoSet={() => setPhotoOpen(true)}
        onComparePair={compareSets ? () => setCompareOpen(true) : undefined}
        onCreateControl={() => setControlOpen(true)}
        onRecordPayment={handleRecordPayment}
        onRecalculatePayments={handleRecalculate}
        isRecalculating={recalculating}
      />

      {diagnosisOpen ? (
        <DiagnosisWizard
          patientId={props.patientId}
          onClose={() => setDiagnosisOpen(false)}
        />
      ) : null}

      {planOpen && props.diagnosis ? (
        <TreatmentPlanWizard
          patientId={props.patientId}
          diagnosisId={props.diagnosis.id}
          onClose={() => setPlanOpen(false)}
        />
      ) : null}

      {photoOpen && props.plan ? (
        <PhotoSetWizard
          patientId={props.patientId}
          treatmentPlanId={props.plan.id}
          availableTypes={types}
          monthInTreatment={props.monthInTreatment}
          onClose={() => setPhotoOpen(false)}
        />
      ) : null}

      {controlOpen && props.plan ? (
        <ControlAppointmentWizard
          patientId={props.patientId}
          treatmentPlanId={props.plan.id}
          monthInTreatment={props.monthInTreatment + 1}
          onClose={() => setControlOpen(false)}
        />
      ) : null}

      {paymentTarget ? (
        <RecordPaymentDrawer
          installment={paymentTarget}
          onClose={() => setPaymentTarget(null)}
        />
      ) : null}

      {compareOpen && compareSets ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 1500,
            padding: 24,
            overflowY: "auto",
          }}
        >
          <div
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              background: "var(--bg)",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <PhotoCompareSlider
              pairs={(["EXTRA_FRONTAL", "EXTRA_PROFILE", "EXTRA_SMILE", "INTRA_FRONTAL_OCCLUSION", "INTRA_LATERAL_RIGHT", "INTRA_LATERAL_LEFT", "INTRA_OCCLUSAL_UPPER", "INTRA_OCCLUSAL_LOWER"] as const).map((view) => {
                const colMap: Record<string, keyof OrthoPhotoSetWithFiles> = {
                  EXTRA_FRONTAL: "photoFrontal",
                  EXTRA_PROFILE: "photoProfile",
                  EXTRA_SMILE: "photoSmile",
                  INTRA_FRONTAL_OCCLUSION: "photoIntraFrontal",
                  INTRA_LATERAL_RIGHT: "photoIntraLateralR",
                  INTRA_LATERAL_LEFT: "photoIntraLateralL",
                  INTRA_OCCLUSAL_UPPER: "photoOcclusalUpper",
                  INTRA_OCCLUSAL_LOWER: "photoOcclusalLower",
                };
                const beforeFile = compareSets.before[colMap[view]] as
                  | { id: string }
                  | null;
                const afterFile = compareSets.after[colMap[view]] as
                  | { id: string }
                  | null;
                return {
                  view,
                  beforeFileId: beforeFile?.id ?? null,
                  beforeUrl: beforeFile ? props.resolveFileUrl(beforeFile.id) : null,
                  afterFileId: afterFile?.id ?? null,
                  afterUrl: afterFile ? props.resolveFileUrl(afterFile.id) : null,
                };
              })}
              beforeLabel={compareSets.before.setType}
              afterLabel={compareSets.after.setType}
              onClose={() => setCompareOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
