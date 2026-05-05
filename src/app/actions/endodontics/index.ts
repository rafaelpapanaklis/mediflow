// Endodontics — barrel export para server actions. Spec §5
//
// REGLA INNEGOCIABLE (lección Periodoncia 05bf50e + replicada en Ortho):
// SOLO reexportar archivos cuya primera línea es `'use server'` + módulos
// puros sin imports server-only.
//
// NO reexportar `./_helpers` — importa auth-context → supabase/server →
// next/headers, eso rompe el bundle del cliente. Los componentes cliente
// que necesitan ENDODONTICS_MODULE_KEY deben importarla desde
// `@/lib/specialties/keys`. ENDO_AUDIT_ACTIONS solo se usa server-side
// dentro de los archivos de actions (importan directo desde `./_helpers`).

export {
  isFailure,
  type ActionResult,
  type Success,
  type Failure,
} from "./result";

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
