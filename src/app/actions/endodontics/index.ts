// Endodontics — barrel export para server actions. Spec §5

export {
  isFailure,
  type ActionResult,
  type Success,
  type Failure,
} from "./result";

export {
  ENDODONTICS_MODULE_KEY,
  ENDO_AUDIT_ACTIONS,
  type EndoAuditAction,
} from "./_helpers";

export { createDiagnosis, updateDiagnosis } from "./diagnosis";
export { recordVitalityTest } from "./vitality";
export {
  startTreatment,
  updateTreatmentStep,
  upsertRootCanal,
  recordIntracanalMedication,
  completeTreatment,
} from "./treatment";
export { scheduleFollowUp, completeFollowUp } from "./followup";
export { createRetreatmentInfo, createApicalSurgery } from "./retreatment";
export {
  exportTreatmentReportPdf,
  exportLegalReportPdf,
  type ExportPdfResult,
} from "./reports";
