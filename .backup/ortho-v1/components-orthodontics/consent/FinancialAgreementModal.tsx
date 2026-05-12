"use client";
// Orthodontics — modal del acuerdo financiero. SPEC §10.5.

import toast from "react-hot-toast";
import { ConsentModalShell } from "./ConsentModalShell";
import { FINANCIAL_AGREEMENT_TEXT, techniqueLabel } from "@/lib/orthodontics/consent-texts";
import { createOrthodonticConsent } from "@/app/actions/orthodontics";
import { isFailure } from "@/app/actions/orthodontics/result";
import type { OrthoPaymentMethod, OrthoTechnique } from "@prisma/client";

export interface FinancialAgreementModalProps {
  patientId: string;
  treatmentPlanId: string;
  patientName: string;
  guardianName?: string | null;
  isMinor: boolean;
  technique: OrthoTechnique;
  estimatedDurationMonths: number;
  totalCostMxn: number;
  initialDownPayment: number;
  installmentAmount: number;
  installmentCount: number;
  paymentDayOfMonth: number;
  startDate: string;
  endDate: string;
  preferredPaymentMethod: OrthoPaymentMethod;
  removalAppointmentCost?: number;
  clinicLegalName: string;
  clinicRepresentative: string;
  city?: string;
  onClose: () => void;
  onSigned?: () => void;
}

export function FinancialAgreementModal(props: FinancialAgreementModalProps) {
  const today = new Date();
  const text = FINANCIAL_AGREEMENT_TEXT
    .replace(/\{clinicLegalName\}/g, props.clinicLegalName)
    .replace(/\{clinicRepresentative\}/g, props.clinicRepresentative)
    .replace(/\{patientFullName\}/g, props.patientName)
    .replace(/\{guardianFullName\}/g, props.guardianName ?? "—")
    .replace(/\{guardianRelationship\}/g, props.isMinor ? "tutor" : "—")
    .replace(/\{totalCostMxn\}/g, props.totalCostMxn.toLocaleString("es-MX"))
    .replace(/\{technique\}/g, techniqueLabel(props.technique))
    .replace(/\{estimatedDurationMonths\}/g, String(props.estimatedDurationMonths))
    .replace(/\{initialDownPayment\}/g, props.initialDownPayment.toLocaleString("es-MX"))
    .replace(/\{installmentCount\}/g, String(props.installmentCount))
    .replace(/\{installmentAmount\}/g, props.installmentAmount.toLocaleString("es-MX"))
    .replace(/\{paymentDayOfMonth\}/g, String(props.paymentDayOfMonth))
    .replace(/\{startDate\}/g, new Date(props.startDate).toLocaleDateString("es-MX"))
    .replace(/\{endDate\}/g, new Date(props.endDate).toLocaleDateString("es-MX"))
    .replace(/\{preferredPaymentMethod\}/g, props.preferredPaymentMethod.toLowerCase())
    .replace(
      /\{removalAppointmentCost\}/g,
      String(props.removalAppointmentCost ?? 0),
    )
    .replace(/\{rfc, razonSocial, regimenFiscal, usoCfdi\}/g, "(según datos fiscales del paciente)")
    .replace(/\{city\}/g, props.city ?? "—")
    .replace(/\{day\}/g, String(today.getDate()))
    .replace(/\{month\}/g, today.toLocaleDateString("es-MX", { month: "long" }))
    .replace(/\{year\}/g, String(today.getFullYear()))
    .replace(/\{signerRole\}/g, props.isMinor ? "Responsable financiero" : "Paciente");

  const handleSign = async (signatures: { primary: string }) => {
    const signerName = props.isMinor ? props.guardianName ?? "Tutor" : props.patientName;
    const result = await createOrthodonticConsent({
      patientId: props.patientId,
      treatmentPlanId: props.treatmentPlanId,
      consentType: "FINANCIAL",
      signedAt: new Date().toISOString(),
      signerName,
      signerRelationship: props.isMinor ? "tutor" : "self",
      patientSignatureImage: signatures.primary,
      guardianSignatureImage: null,
      signedFileId: null,
      notes: null,
    });
    if (isFailure(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Acuerdo financiero firmado");
    props.onSigned?.();
    props.onClose();
  };

  return (
    <ConsentModalShell
      title="Acuerdo financiero"
      subtitle={`Total: $${props.totalCostMxn.toLocaleString("es-MX")} MXN`}
      text={text}
      signerLabel={props.isMinor ? "Firma del responsable financiero" : "Firma del paciente"}
      onClose={props.onClose}
      onSign={handleSign}
    />
  );
}
