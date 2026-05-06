"use client";
// Orthodontics — shell del módulo. SPEC §6.4. Combina sub-tabs + vistas.

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
import type { OrthoPhaseKey } from "@prisma/client";
import { OrthoSubTabs, useOrthoTab, type OrthoTabKey } from "./OrthoSubTabs";
import { EmptyState } from "./EmptyState";
import { DiagnosisView } from "./diagnosis/DiagnosisView";
import { TreatmentPlanView } from "./plan/TreatmentPlanView";
import { PhotoSetGrid } from "./photos/PhotoSetGrid";
import { ControlsList } from "./controls/ControlsList";
import { PaymentPlanView } from "./payments/PaymentPlanView";
import { DigitalRecordsPanel } from "./digital/DigitalRecordsPanel";
import { PediatricProfileBanner } from "./shared/PediatricProfileBanner";
import { OrthoStageBadge } from "./shared/OrthoStageBadge";
import { OrthoPaymentPlanCard } from "./payments/OrthoPaymentPlanCard";

export interface OrthodonticsTabProps {
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
  onStartDiagnosis?: () => void;
  onEditDiagnosis?: () => void;
  onCreatePlan?: () => void;
  onAdvancePhase?: (toPhase: OrthoPhaseKey) => void;
  isAdvancingPhase?: boolean;
  onCreatePhotoSet?: () => void;
  onComparePair?: () => void;
  onCreateControl?: () => void;
  onRecordPayment?: (installmentId: string) => void;
  onRecalculatePayments?: () => void;
  isRecalculating?: boolean;
  onAddDigitalRecord?: () => void;
}

export function OrthodonticsTab(props: OrthodonticsTabProps) {
  const initialTab: OrthoTabKey = !props.diagnosis
    ? "diagnostico"
    : !props.plan
      ? "plan"
      : "controles";
  const [tab, setTab] = useOrthoTab(initialTab);
  const currentPhaseKey = props.phases.find((p) => p.status === "IN_PROGRESS")?.phaseKey;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {props.isMinor ? (
        <PediatricProfileBanner
          patientId={props.patientId}
          hasProfile={Boolean(props.hasPediatricProfile)}
          pediatricsModuleActive={Boolean(props.pediatricsModuleActive)}
          patientFirstName={props.patientName.split(" ")[0] ?? props.patientName}
          guardianName={props.guardianName}
          habits={props.pediatricHabits}
        />
      ) : null}

      {currentPhaseKey ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <OrthoStageBadge phaseKey={currentPhaseKey} />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            Mes {props.monthInTreatment}
            {props.plan ? ` / ${props.plan.estimatedDurationMonths}` : ""}
          </span>
        </div>
      ) : null}

      {props.plan ? (
        <OrthoPaymentPlanCard
          paymentPlan={props.paymentPlan}
          installments={props.installments}
          onViewPlan={() => setTab("pagos")}
        />
      ) : null}

      <OrthoSubTabs
        active={tab}
        onChange={setTab}
        counts={{
          fotos: props.photoSets.length || undefined,
          controles: props.controls.length || undefined,
          pagos: props.paymentPlan
            ? `${props.installments.filter((i) => i.status === "PAID").length}/${props.installments.length}`
            : undefined,
        }}
      />

      {tab === "diagnostico" ? (
        props.diagnosis ? (
          <DiagnosisView diagnosis={props.diagnosis} onEdit={props.onEditDiagnosis} />
        ) : (
          <EmptyState
            title="Sin diagnóstico ortodóntico"
            description="Captura el diagnóstico inicial — análisis Angle, mordida, apiñamiento, etiología, hábitos y resumen clínico — para empezar el expediente."
            cta={
              props.onStartDiagnosis
                ? { label: "+ Iniciar diagnóstico", onClick: props.onStartDiagnosis }
                : undefined
            }
          />
        )
      ) : null}

      {tab === "plan" ? (
        props.plan ? (
          <TreatmentPlanView
            plan={props.plan}
            phases={props.phases}
            monthInTreatment={props.monthInTreatment}
            onAdvance={props.onAdvancePhase}
            isAdvancing={props.isAdvancingPhase}
          />
        ) : props.diagnosis ? (
          <EmptyState
            title="Sin plan de tratamiento"
            description="Configura técnica, duración, anclaje, extracciones, objetivos y plan de retención. Al guardarlo se firma el consentimiento del paciente o tutor."
            cta={
              props.onCreatePlan ? { label: "+ Crear plan", onClick: props.onCreatePlan } : undefined
            }
          />
        ) : (
          <EmptyState
            title="Captura primero el diagnóstico"
            description="No puedes crear el plan sin haber capturado el diagnóstico inicial."
          />
        )
      ) : null}

      {tab === "fotos" ? (
        <>
          <PhotoSetGrid
            sets={props.photoSets}
            resolveUrl={props.resolveFileUrl}
            onAddSet={props.onCreatePhotoSet}
            onComparePair={props.onComparePair}
          />
          <DigitalRecordsPanel
            records={props.digitalRecords}
            resolveUrl={props.resolveFileUrl}
            onAdd={props.onAddDigitalRecord}
          />
        </>
      ) : null}

      {tab === "controles" ? (
        <ControlsList controls={props.controls} onCreate={props.onCreateControl} />
      ) : null}

      {tab === "pagos" ? (
        props.paymentPlan ? (
          <PaymentPlanView
            plan={props.paymentPlan}
            installments={props.installments}
            onRecordPayment={props.onRecordPayment}
            onRecalculate={props.onRecalculatePayments}
            isRecalculating={props.isRecalculating}
            agreementPdfHref={props.agreementPdfHref}
          />
        ) : (
          <EmptyState
            title="Sin plan de pagos"
            description="Configura el acuerdo financiero: enganche, número de mensualidades, monto, día de pago y método preferente. Se firma con el responsable financiero."
            cta={
              props.onCreatePlan
                ? { label: "+ Crear plan de pagos", onClick: props.onCreatePlan }
                : undefined
            }
          />
        )
      ) : null}
    </div>
  );
}
