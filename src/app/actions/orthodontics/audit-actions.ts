// Orthodontics — catálogo estable de acciones de audit log. SPEC §8.8.
// Client-safe (sin imports server-only).

export const ORTHO_AUDIT_ACTIONS = {
  DIAGNOSIS_CREATED: "ortho.diagnosis.created",
  DIAGNOSIS_UPDATED: "ortho.diagnosis.updated",
  TREATMENT_PLAN_CREATED: "ortho.treatmentPlan.created",
  TREATMENT_PLAN_UPDATED: "ortho.treatmentPlan.updated",
  TREATMENT_PLAN_STATUS_CHANGED: "ortho.treatmentPlan.statusChanged",
  PHASE_ADVANCED: "ortho.phase.advanced",
  PAYMENT_PLAN_CREATED: "ortho.paymentPlan.created",
  INSTALLMENT_PAID: "ortho.installment.paid",
  INSTALLMENT_WAIVED: "ortho.installment.waived",
  PAYMENT_STATUS_RECALCULATED: "ortho.paymentStatus.recalculated",
  PHOTO_SET_CREATED: "ortho.photoSet.created",
  PHOTO_UPLOADED: "ortho.photoSet.photoUploaded",
  CONTROL_CREATED: "ortho.control.created",
  DIGITAL_RECORD_LINKED: "ortho.digitalRecord.linked",
  CONSENT_SIGNED: "ortho.consent.signed",
  REPORT_TREATMENT_PLAN_PDF: "ortho.report.treatmentPlan.pdf",
  REPORT_FINANCIAL_AGREEMENT_PDF: "ortho.report.financialAgreement.pdf",
  REPORT_PROGRESS_PDF: "ortho.report.progress.pdf",
} as const;

export type OrthoAuditAction =
  (typeof ORTHO_AUDIT_ACTIONS)[keyof typeof ORTHO_AUDIT_ACTIONS];
