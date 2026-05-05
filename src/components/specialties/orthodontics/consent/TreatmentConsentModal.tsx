"use client";
// Orthodontics — modal del consentimiento de tratamiento. SPEC §10.4.

import toast from "react-hot-toast";
import { ConsentModalShell } from "./ConsentModalShell";
import { TREATMENT_CONSENT_TEXT, techniqueLabel } from "@/lib/orthodontics/consent-texts";
import { createOrthodonticConsent } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { OrthoTechnique } from "@prisma/client";

export interface TreatmentConsentModalProps {
  patientId: string;
  treatmentPlanId: string;
  patientName: string;
  isMinor: boolean;
  guardianName?: string | null;
  technique: OrthoTechnique;
  estimatedDurationMonths: number;
  retentionPlanText: string;
  doctorName: string;
  doctorLicense: string;
  city?: string;
  diagnosisAccessibleSummary?: string;
  treatmentObjectives?: string;
  onClose: () => void;
  onSigned?: () => void;
}

export function TreatmentConsentModal(props: TreatmentConsentModalProps) {
  const today = new Date();
  const text = TREATMENT_CONSENT_TEXT
    .replace(/\{patientFullName\}/g, props.patientName)
    .replace(/\{birthDate\}/g, "—")
    .replace(/\{fileNumber\}/g, "—")
    .replace(/\{doctorFullName\}/g, props.doctorName)
    .replace(/\{doctorLicense\}/g, props.doctorLicense)
    .replace(/\{technique\}/g, techniqueLabel(props.technique))
    .replace(/\{techniqueNotes\}/g, "—")
    .replace(/\{diagnosisAccessibleSummary\}/g, props.diagnosisAccessibleSummary ?? "—")
    .replace(
      /\{treatmentObjectives\}/g,
      props.treatmentObjectives ?? "—",
    )
    .replace(/\{estimatedDurationMonths\}/g, String(props.estimatedDurationMonths))
    .replace(/\{retentionPlanText\}/g, props.retentionPlanText)
    .replace(/\{city\}/g, props.city ?? "—")
    .replace(/\{day\}/g, String(today.getDate()))
    .replace(/\{month\}/g, today.toLocaleDateString("es-MX", { month: "long" }))
    .replace(/\{year\}/g, String(today.getFullYear()))
    .replace(/\{signerRole\}/g, props.isMinor ? "Tutor responsable" : "Paciente")
    .replace(/\{guardianRelationship\}/g, props.isMinor ? props.guardianName ?? "Tutor" : "");

  const handleSign = async (signatures: { primary: string; secondary?: string }) => {
    const signerName = props.isMinor ? props.guardianName ?? "Tutor" : props.patientName;
    const signerRelationship = props.isMinor ? "tutor" : "self";

    const result = await createOrthodonticConsent({
      patientId: props.patientId,
      treatmentPlanId: props.treatmentPlanId,
      consentType: "TREATMENT",
      signedAt: new Date().toISOString(),
      signerName,
      signerRelationship,
      patientSignatureImage: signatures.primary,
      guardianSignatureImage: signatures.secondary ?? null,
      signedFileId: null,
      notes: null,
    });
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Consentimiento de tratamiento firmado");
    props.onSigned?.();
    props.onClose();
  };

  return (
    <ConsentModalShell
      title="Consentimiento de tratamiento ortodóntico"
      subtitle={`Técnica: ${techniqueLabel(props.technique)}`}
      text={text}
      signerLabel={props.isMinor ? "Firma del tutor" : "Firma del paciente"}
      onClose={props.onClose}
      onSign={handleSign}
    />
  );
}
