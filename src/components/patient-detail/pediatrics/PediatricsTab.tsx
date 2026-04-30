"use client";
// Pediatrics — shell del módulo, recibe data ya cargada en server. Spec: §1.2, §4.A.4

import { useState } from "react";
import { PediatricsContextStrip } from "./PediatricsContextStrip";
import { PediatricsSiderail } from "./PediatricsSiderail";
import { PediatricsSubNav, type PediatricsTabKey } from "./PediatricsSubNav";
import { SummarySection } from "./sections/SummarySection";
import { OdontogramSection } from "./sections/OdontogramSection";
import { EruptionSection } from "./sections/EruptionSection";
import { HabitsSection } from "./sections/HabitsSection";
import { BehaviorSection } from "./sections/BehaviorSection";
import { PreventivePlanSection } from "./sections/PreventivePlanSection";
import { FranklDrawer } from "./drawers/FranklDrawer";
import { CambraDrawer } from "./drawers/CambraDrawer";
import type { CambraCategory } from "@/lib/pediatrics/cambra";
import type { DentitionType } from "@/lib/pediatrics/dentition";
import type {
  BehaviorAssessmentRow,
  CariesRiskAssessmentRow,
  EruptionRecordRow,
  FluorideApplicationRow,
  GuardianRow,
  OralHabitRow,
  PediatricConsentRow,
  SealantRow,
  SpaceMaintainerRow,
} from "@/types/pediatrics";

export interface PediatricsTabData {
  patientId: string;
  patientName: string;
  patientDob: Date;
  ageFormatted: string;
  ageMonths: number;
  dentition: DentitionType;
  primaryGuardian: GuardianRow | null;
  guardiansCount: number;
  allergies: string[];
  conditions: string[];
  latestCambra: CariesRiskAssessmentRow | null;
  behaviorHistory: BehaviorAssessmentRow[];
  oralHabits: OralHabitRow[];
  eruptionRecords: EruptionRecordRow[];
  sealants: SealantRow[];
  maintainers: SpaceMaintainerRow[];
  fluorideHistory: FluorideApplicationRow[];
  pendingConsents: PediatricConsentRow[];
  nextAppointmentLabel?: string;
}

export type PediatricsTabVariant = "embedded" | "full-page";

export interface PediatricsTabProps {
  data: PediatricsTabData;
  initialTab?: PediatricsTabKey;
  /**
   * - `embedded` (default): vista dentro del detalle de paciente; usa el
   *   ancho compartido de la pestaña.
   * - `full-page`: vista en página dedicada (/dashboard/specialties/pediatrics/[id]),
   *   max-w 1280px y paddings holgados.
   */
  variant?: PediatricsTabVariant;
}

export function PediatricsTab(props: PediatricsTabProps) {
  const { data, initialTab, variant = "embedded" } = props;
  const [activeTab, setActiveTab] = useState<PediatricsTabKey>(initialTab ?? "summary");
  const [franklOpen, setFranklOpen] = useState(false);
  const [cambraOpen, setCambraOpen] = useState(false);

  const latestFranklValues = data.behaviorHistory
    .filter((b) => b.scale === "frankl" && !b.deletedAt)
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    .slice(-2)
    .map((b) => ({ value: b.value, date: b.recordedAt }));

  const activeMaintainer =
    data.maintainers.find((m) => !m.deletedAt && m.currentStatus === "activo") ?? null;

  const counts: Partial<Record<PediatricsTabKey, number>> = {
    eruption: data.eruptionRecords.filter((r) => !r.deletedAt).length,
    habits:   data.oralHabits.filter((h) => !h.deletedAt && !h.endedAt).length,
    behavior: data.behaviorHistory.filter((b) => !b.deletedAt).length,
  };

  return (
    <div className={`pedi-shell ${variant === "full-page" ? "pedi-shell--full-page" : ""}`}>
      <PediatricsContextStrip
        ageFormatted={data.ageFormatted}
        dentition={data.dentition}
        latestFranklValues={latestFranklValues}
        latestCambraCategory={(data.latestCambra?.category as CambraCategory | undefined) ?? null}
        nextAppointmentLabel={data.nextAppointmentLabel}
        onCaptureFrankl={() => setFranklOpen(true)}
        onCaptureCambra={() => setCambraOpen(true)}
      />

      <div className="pedi-grid">
        <PediatricsSiderail
          patientId={data.patientId}
          patientName={data.patientName}
          primaryGuardian={data.primaryGuardian}
          totalGuardians={data.guardiansCount}
          allergies={data.allergies}
          conditions={data.conditions}
          pendingConsents={data.pendingConsents}
        />

        <div className="pedi-main">
          <PediatricsSubNav active={activeTab} onChange={setActiveTab} counts={counts} />

          {activeTab === "summary" && (
            <SummarySection
              patientId={data.patientId}
              patientName={data.patientName}
              guardianName={data.primaryGuardian?.fullName ?? null}
              latestCambra={data.latestCambra}
              behaviorHistory={data.behaviorHistory}
              sealants={data.sealants}
              activeMaintainer={activeMaintainer}
              pendingConsents={data.pendingConsents}
            />
          )}
          {activeTab === "odontogram" && (
            <OdontogramSection
              patientId={data.patientId}
              defaultView={data.dentition}
              sealants={data.sealants}
            />
          )}
          {activeTab === "eruption" && (
            <EruptionSection
              patientId={data.patientId}
              patientAgeMonths={data.ageMonths}
              records={data.eruptionRecords}
            />
          )}
          {activeTab === "habits" && (
            <HabitsSection
              patientId={data.patientId}
              patientDob={data.patientDob}
              habits={data.oralHabits}
            />
          )}
          {activeTab === "behavior" && (
            <BehaviorSection
              patientId={data.patientId}
              history={data.behaviorHistory}
            />
          )}
          {activeTab === "preventive" && (
            <PreventivePlanSection
              patientId={data.patientId}
              latestCambra={data.latestCambra}
              sealants={data.sealants}
              maintainers={data.maintainers}
              fluorideHistory={data.fluorideHistory}
            />
          )}
        </div>
      </div>

      <FranklDrawer open={franklOpen} onClose={() => setFranklOpen(false)} patientId={data.patientId} />
      <CambraDrawer open={cambraOpen} onClose={() => setCambraOpen(false)} patientId={data.patientId} />
    </div>
  );
}
