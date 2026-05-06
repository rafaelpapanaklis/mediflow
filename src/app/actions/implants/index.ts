// Implants — barrel para server actions. Spec §5.
//
// REGLA INNEGOCIABLE (lección aprendida en Periodoncia):
// Este barrel SOLO reexporta archivos cuya primer línea es 'use server'.
// NO reexporta _helpers.ts (importa supabase/server / next/headers),
// NI result.ts ni audit-actions.ts. Componentes que necesiten esos
// helpers los importan directos:
//   import { isFailure } from "@/app/actions/implants/result";
//   import { IMPLANT_AUDIT_ACTIONS } from "@/app/actions/implants/audit-actions";
//
// Si un componente cliente importa este barrel, solo arrastra Server
// Action references (boundary correcta). Cualquier reexport de un
// módulo server-only desde este archivo rompería el build de Next.js.

export { createImplant } from "./createImplant";
export { updateImplantTraceability } from "./updateImplantTraceability";
export { removeImplant } from "./removeImplant";
export { createSurgicalRecord } from "./createSurgicalRecord";
export { updateImplantStatus } from "./updateImplantStatus";
export { createHealingPhase } from "./createHealingPhase";
export { createSecondStageSurgery } from "./createSecondStageSurgery";
export { createProstheticPhase } from "./createProstheticPhase";
export { createComplication } from "./createComplication";
export { createFollowUp } from "./createFollowUp";
export { createImplantConsent } from "./createImplantConsent";
export { generateImplantPassport } from "./generateImplantPassport";
export { exportSurgicalReportPdf } from "./exportSurgicalReportPdf";
export { exportImplantPlanPdf } from "./exportImplantPlanPdf";
export { createPeriImplantAssessment } from "./createPeriImplantAssessment";
export { enableQrPublicAccess } from "./enableQrPublicAccess";
export {
  linkImplantPhaseToTreatmentSession,
  onImplantSurgicalPhaseComplete,
  onImplantHealingComplete,
  onImplantProstheticComplete,
} from "./linkTreatmentSession";
