"use client";
// Pediatrics — sub-tab Resumen (dashboard de cards y mini charts). Spec: §1.7, §4.A.5

import { useState } from "react";
import { Plus } from "lucide-react";
import { RiskCard } from "../cards/RiskCard";
import { FrankSparklineCard } from "../cards/FrankSparklineCard";
import { SealantCard } from "../cards/SealantCard";
import { MaintainerCard } from "../cards/MaintainerCard";
import { ConsentPendingCard } from "../cards/ConsentPendingCard";
import { ConsentModal } from "../modals/ConsentModal";
import { FranklDrawer } from "../drawers/FranklDrawer";
import { CambraDrawer } from "../drawers/CambraDrawer";
import type {
  BehaviorAssessmentRow,
  CariesRiskAssessmentRow,
  PediatricConsentRow,
  SealantRow,
  SpaceMaintainerRow,
} from "@/types/pediatrics";
import type { CambraCategory } from "@/lib/pediatrics/cambra";

export interface SummarySectionProps {
  patientId: string;
  patientName: string;
  guardianName: string | null;
  latestCambra: CariesRiskAssessmentRow | null;
  behaviorHistory: BehaviorAssessmentRow[];
  sealants: SealantRow[];
  activeMaintainer: SpaceMaintainerRow | null;
  pendingConsents: PediatricConsentRow[];
}

export function SummarySection(props: SummarySectionProps) {
  const [franklOpen, setFranklOpen] = useState(false);
  const [cambraOpen, setCambraOpen] = useState(false);
  const [consentToSign, setConsentToSign] = useState<PediatricConsentRow | null>(null);

  return (
    <div className="pedi-section">
      <div className="pedi-section__header">
        <h2 className="pedi-section__title">Resumen pediátrico</h2>
        <div className="pedi-section__actions">
          <button type="button" className="pedi-btn" onClick={() => setFranklOpen(true)}>
            <Plus size={14} aria-hidden /> Frankl
          </button>
          <button type="button" className="pedi-btn" onClick={() => setCambraOpen(true)}>
            <Plus size={14} aria-hidden /> CAMBRA
          </button>
        </div>
      </div>

      <ConsentPendingCard
        pending={props.pendingConsents}
        onSign={(id) => {
          const c = props.pendingConsents.find((x) => x.id === id);
          if (c) setConsentToSign(c);
        }}
      />

      <div className="pedi-summary-grid">
        <RiskCard
          category={(props.latestCambra?.category as CambraCategory | undefined) ?? null}
          recallMonths={props.latestCambra?.recommendedRecallMonths}
          scoredAt={props.latestCambra?.scoredAt}
          nextDueAt={props.latestCambra?.nextDueAt}
        />
        <FrankSparklineCard history={props.behaviorHistory} />
        <SealantCard sealants={props.sealants} />
        <MaintainerCard active={props.activeMaintainer} />
      </div>

      <FranklDrawer open={franklOpen} onClose={() => setFranklOpen(false)} patientId={props.patientId} />
      <CambraDrawer open={cambraOpen} onClose={() => setCambraOpen(false)} patientId={props.patientId} />
      {consentToSign ? (
        <ConsentModal
          open={Boolean(consentToSign)}
          onClose={() => setConsentToSign(null)}
          consentId={consentToSign.id}
          procedureLabel={labelProcedure(consentToSign.procedureType)}
          patientName={props.patientName}
          guardianName={props.guardianName ?? consentToSign.guardian.fullName}
          minorAssentRequired={consentToSign.minorAssentRequired}
        />
      ) : null}
    </div>
  );
}

function labelProcedure(p: string): string {
  const map: Record<string, string> = {
    anestesia_local: "Anestesia local",
    sedacion_consciente: "Sedación consciente",
    oxido_nitroso: "Óxido nitroso",
    extraccion: "Extracción",
    pulpotomia: "Pulpotomía",
    pulpectomia: "Pulpectomía",
    fluorizacion: "Fluorización",
    toma_impresiones: "Toma de impresiones",
    rx_intraoral: "Rx intraoral",
    otro: "Otro",
  };
  return map[p] ?? p;
}
