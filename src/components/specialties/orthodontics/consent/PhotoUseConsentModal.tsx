"use client";
// Orthodontics — modal del consentimiento de uso de fotografías. SPEC §10.7.

import toast from "react-hot-toast";
import { ConsentModalShell } from "./ConsentModalShell";
import { PHOTO_USE_CONSENT_TEXT } from "@/lib/orthodontics/consent-texts";
import { createOrthodonticConsent } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";

export interface PhotoUseConsentModalProps {
  patientId: string;
  treatmentPlanId: string;
  patientName: string;
  guardianName?: string | null;
  isMinor: boolean;
  clinicLegalName: string;
  clinicRepresentative: string;
  city?: string;
  onClose: () => void;
  onSigned?: () => void;
}

export function PhotoUseConsentModal(props: PhotoUseConsentModalProps) {
  const today = new Date();
  const text = PHOTO_USE_CONSENT_TEXT
    .replace(/\{patientFullName\}/g, props.patientName)
    .replace(/\{guardianFullName\}/g, props.guardianName ?? "—")
    .replace(/\{guardianRelationship\}/g, props.isMinor ? "tutor" : "—")
    .replace(/\{clinicLegalName\}/g, props.clinicLegalName)
    .replace(/\{clinicRepresentative\}/g, props.clinicRepresentative)
    .replace(/\{city\}/g, props.city ?? "—")
    .replace(/\{day\}/g, String(today.getDate()))
    .replace(/\{month\}/g, today.toLocaleDateString("es-MX", { month: "long" }))
    .replace(/\{year\}/g, String(today.getFullYear()))
    .replace(/\{signerRole\}/g, props.isMinor ? "Tutor responsable" : "Paciente");

  const handleSign = async (signatures: { primary: string }) => {
    const signerName = props.isMinor ? props.guardianName ?? "Tutor" : props.patientName;
    const result = await createOrthodonticConsent({
      patientId: props.patientId,
      treatmentPlanId: props.treatmentPlanId,
      consentType: "PHOTO_USE",
      signedAt: new Date().toISOString(),
      signerName,
      signerRelationship: props.isMinor ? "tutor" : "self",
      patientSignatureImage: signatures.primary,
      guardianSignatureImage: null,
      signedFileId: null,
      notes:
        "El paciente debe marcar manualmente las opciones permitidas en el documento físico antes de firmar — la opción es expresa y revocable.",
    });
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Consentimiento de uso de fotografías firmado");
    props.onSigned?.();
    props.onClose();
  };

  return (
    <ConsentModalShell
      title="Uso de fotografías clínicas"
      subtitle="Autorización opcional, revocable"
      text={text}
      signerLabel={props.isMinor ? "Firma del tutor" : "Firma del paciente"}
      onClose={props.onClose}
      onSign={handleSign}
    />
  );
}
