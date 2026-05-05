// Periodontics — barrel export para server actions. SPEC §5
//
// IMPORTANTE: este barrel SOLO reexporta archivos que son seguros para que
// los importe un componente cliente (`PeriodonticsClient.tsx` lo hace).
//   - `./result` es puro (sin imports server-only) → client-safe.
//   - Los archivos de actions empiezan con `"use server"` → Next.js los
//     trata como RPC, no arrastra sus dependencias al bundle del cliente.
//
// NUNCA reexportes `./_helpers` ni ningún archivo con prefijo `_`: contiene
// `getAuthContext` que importa `next/headers` vía `supabase/server`, y eso
// rompe el build del lado del cliente. Si necesitas constantes server-only
// (PERIO_AUDIT_ACTIONS, PERIODONTICS_MODULE_KEY local), importa directo
// desde `./_helpers` en los propios archivos de actions, o desde
// `@/lib/specialties/keys` (client-safe) en pages/routes/components.

export {
  isFailure,
  type ActionResult,
  type Success,
  type Failure,
} from "./result";

export {
  createPeriodontalRecord,
  createEmptyPeriodontalRecord,
  updatePeriodontalRecord,
  finalizePerioChart,
  deletePeriodontalRecord,
} from "./chart";

export {
  upsertSiteData,
  upsertToothData,
  bulkUpsertSiteData,
} from "./sites";

export { classifyPatient, overrideClassification } from "./classification";

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

export { signSrpConsent, signSurgeryConsent } from "./consents";

export {
  exportPerioPatientReportPdf,
  exportPerioReferrerReportPdf,
  exportPerioPrePostComparePdf,
  type PerioPdfResult,
} from "./reports";
