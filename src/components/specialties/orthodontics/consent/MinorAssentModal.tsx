"use client";
// Orthodontics — modal del asentimiento del menor (≥12 y <18). SPEC §10.6.

import toast from "react-hot-toast";
import { ConsentModalShell } from "./ConsentModalShell";
import {
  MINOR_ASSENT_TEXT,
  techniqueAccessibleName,
} from "@/lib/orthodontics/consent-texts";
import { createOrthodonticConsent } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { OrthoTechnique } from "@prisma/client";

export interface MinorAssentModalProps {
  patientId: string;
  treatmentPlanId: string;
  minorFullName: string;
  minorAge: number;
  technique: OrthoTechnique;
  estimatedDurationMonths: number;
  onClose: () => void;
  onSigned?: () => void;
}

export function MinorAssentModal(props: MinorAssentModalProps) {
  const minorFirst = props.minorFullName.split(" ")[0] ?? props.minorFullName;
  const today = new Date().toLocaleDateString("es-MX");
  const text = MINOR_ASSENT_TEXT
    .replace(/\{minorFirstName\}/g, minorFirst)
    .replace(/\{minorAge\}/g, String(props.minorAge))
    .replace(/\{techniqueAccessibleName\}/g, techniqueAccessibleName(props.technique))
    .replace(/\{estimatedDurationMonths\}/g, String(props.estimatedDurationMonths))
    .replace(
      /\{estimatedDurationPlus30Percent\}/g,
      String(Math.round(props.estimatedDurationMonths * 1.3)),
    )
    .replace(/\{minorFullName\}/g, props.minorFullName)
    .replace(/\{today\}/g, today);

  const handleSign = async (signatures: { primary: string }) => {
    const result = await createOrthodonticConsent({
      patientId: props.patientId,
      treatmentPlanId: props.treatmentPlanId,
      consentType: "MINOR_ASSENT",
      signedAt: new Date().toISOString(),
      signerName: props.minorFullName,
      signerRelationship: "self",
      patientSignatureImage: signatures.primary,
      guardianSignatureImage: null,
      signedFileId: null,
      notes: null,
    });
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success(`Asentimiento de ${minorFirst} firmado`);
    props.onSigned?.();
    props.onClose();
  };

  return (
    <ConsentModalShell
      title="Asentimiento del menor"
      subtitle={`${props.minorFullName} (${props.minorAge} años)`}
      text={text}
      signerLabel="Firma del menor"
      onClose={props.onClose}
      onSign={handleSign}
    />
  );
}
