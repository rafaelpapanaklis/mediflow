// Implants — catálogo de acciones de audit log. Spec §8.8.
//
// SIN imports de server-only — seguro desde componentes cliente.
// El barrel index.ts NO reexporta este archivo (sigue la regla:
// el barrel SOLO reexporta archivos 'use server'). Componentes que
// necesiten estas constantes importan directamente:
//   import { IMPLANT_AUDIT_ACTIONS } from "@/app/actions/implants/audit-actions";

export const IMPLANT_AUDIT_ACTIONS = {
  IMPLANT_CREATED: "implant.created",
  IMPLANT_STATUS_CHANGED: "implant.status.changed",
  IMPLANT_REMOVED: "implant.removed",
  COFEPRIS_TRACEABILITY_UPDATE: "implant.cofepris.traceability.updated",
  SURGICAL_RECORD_CREATED: "implant.surgical.created",
  HEALING_PHASE_CREATED: "implant.healing.created",
  HEALING_PHASE_UPDATED: "implant.healing.updated",
  SECOND_STAGE_CREATED: "implant.secondStage.created",
  PROSTHETIC_PHASE_CREATED: "implant.prosthetic.created",
  COMPLICATION_CREATED: "implant.complication.created",
  COMPLICATION_RESOLVED: "implant.complication.resolved",
  FOLLOWUP_CREATED: "implant.followup.created",
  FOLLOWUP_COMPLETED: "implant.followup.completed",
  CONSENT_CREATED: "implant.consent.created",
  CONSENT_REVOKED: "implant.consent.revoked",
  PASSPORT_GENERATED: "implant.passport.generated",
  PASSPORT_REGENERATED: "implant.passport.regenerated",
  QR_PUBLIC_ENABLED: "implant.qrPublic.enabled",
  QR_PUBLIC_DISABLED: "implant.qrPublic.disabled",
  REPORT_SURGICAL_PDF: "implant.report.surgical.pdf",
  REPORT_PLAN_PDF: "implant.report.plan.pdf",
  PERI_IMPLANT_ASSESSMENT_STUB: "implant.periImplantAssessment.stub",
} as const;

export type ImplantAuditAction =
  (typeof IMPLANT_AUDIT_ACTIONS)[keyof typeof IMPLANT_AUDIT_ACTIONS];
