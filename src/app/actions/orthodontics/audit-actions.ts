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
  // ─── Rediseño Fase 1.5 ──────────────────────────────────────────────
  WIRE_STEP_ADDED: "ortho.wireStep.added",
  WIRE_STEP_UPDATED: "ortho.wireStep.updated",
  QUOTE_SCENARIO_SELECTED: "ortho.quoteScenario.selected",
  SIGN_AT_HOME_SENT: "ortho.signAtHome.sent",
  COLLECT_RECORDED: "ortho.collect.recorded",
  CFDI_TIMBRADO_REQUESTED: "ortho.cfdi.timbrado.requested",
  RETENTION_PRE_SURVEY_TOGGLED: "ortho.retention.preSurvey.toggled",
  RETENTION_REGIMEN_CONFIGURED: "ortho.retention.regimen.configured",
  RETAINER_CHECKUPS_SCHEDULED: "ortho.retention.checkups.scheduled",
  NPS_SCHEDULED: "ortho.nps.scheduled",
  NPS_RESPONSE_RECORDED: "ortho.nps.response.recorded",
  GOOGLE_REVIEW_TRIGGERED: "ortho.googleReview.triggered",
  REFERRAL_CODE_CREATED: "ortho.referralCode.created",
  LAB_ORDER_CREATED: "ortho.labOrder.created",
  REPORT_BEFORE_AFTER_PDF: "ortho.report.beforeAfter.pdf",
  G15_CHECKPOINT_SCHEDULED: "ortho.g15.checkpoint.scheduled",
} as const;

export type OrthoAuditAction =
  (typeof ORTHO_AUDIT_ACTIONS)[keyof typeof ORTHO_AUDIT_ACTIONS];
