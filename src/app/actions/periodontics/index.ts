// Periodontics — barrel export para server actions. SPEC §5

export {
  isFailure,
  type ActionResult,
  type Success,
  type Failure,
} from "./result";

export {
  PERIODONTICS_MODULE_KEY,
  PERIO_AUDIT_ACTIONS,
  type PerioAuditAction,
} from "./_helpers";

export {
  createPeriodontalRecord,
  updatePeriodontalRecord,
  finalizePerioChart,
  deletePeriodontalRecord,
} from "./chart";

export {
  upsertSiteData,
  upsertToothData,
  bulkUpsertSiteData,
} from "./sites";

export { classifyPatient } from "./classification";

export {
  createGingivalRecession,
  resolveGingivalRecession,
} from "./recession";

export { createRiskAssessment } from "./risk";

export { createPeriImplantAssessment } from "./peri-implant";

export { createTreatmentPlan, advancePhase } from "./plan";
export { createSRPSession } from "./srp";
export { createReevaluation } from "./reevaluation";
export { createPeriodontalSurgery } from "./surgery";
export { scheduleMaintenance, completeMaintenance } from "./maintenance";
