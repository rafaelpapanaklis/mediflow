// Orthodontics — barrel ESTRICTO. SPEC §1.18 + lección Periodoncia.
//
// REGLA INNEGOCIABLE: este barrel SOLO reexporta archivos cuya primera línea
// es `"use server"`. Esos archivos los trata Next.js como RPC y NO arrastra
// sus dependencias al bundle del cliente.
//
// NUNCA reexportes:
//   - `./_helpers` — importa auth-context → supabase/server → next/headers.
//     Eso rompe el build cliente (lección Periodoncia commit 05bf50e).
//   - `./result` — los componentes lo importan directo desde
//     `@/app/actions/orthodontics/result`.
//   - `./audit-actions` — idem, importación directa.
//
// Si necesitas constantes server-only en una action, importa directo
// desde `./_helpers` (file-to-file, server-only).

export { createDiagnosis } from "./createDiagnosis";
export { updateDiagnosis } from "./updateDiagnosis";
export { createTreatmentPlan } from "./createTreatmentPlan";
export { updateTreatmentPlan } from "./updateTreatmentPlan";
export { advanceTreatmentPhase } from "./advanceTreatmentPhase";
export { createPaymentPlan } from "./createPaymentPlan";
export { recordInstallmentPayment } from "./recordInstallmentPayment";
export { recalculatePaymentStatus } from "./recalculatePaymentStatus";
export { createPhotoSet } from "./createPhotoSet";
export { uploadPhotoToSet } from "./uploadPhotoToSet";
export { createControlAppointment } from "./createControlAppointment";
export { linkDigitalRecord } from "./linkDigitalRecord";
export { createOrthodonticConsent } from "./createOrthodonticConsent";
export { exportTreatmentPlanPdf } from "./exportTreatmentPlanPdf";
export { exportFinancialAgreementPdf } from "./exportFinancialAgreementPdf";
export { recordElasticsCompliance } from "./recordElasticsCompliance";
export { exportComparisonPdf } from "./exportComparisonPdf";

// ─── Rediseño Fase 1.5 ──────────────────────────────────────────────────
export { addWireStep } from "./addWireStep";
export { selectQuoteScenario } from "./selectQuoteScenario";
export { sendSignAtHomeLink } from "./sendSignAtHomeLink";
export { confirmCollect } from "./confirmCollect";
export { createOrthoLabOrder } from "./createOrthoLabOrder";
export { toggleRetentionPreSurvey } from "./toggleRetentionPreSurvey";
export { createReferralCode } from "./createReferralCode";
export { recordNpsResponse } from "./recordNpsResponse";
export { scheduleRetentionCheckups } from "./scheduleRetentionCheckups";
export { scheduleNpsTimeline } from "./scheduleNpsTimeline";

// ─── Rediseño Fase 1.5 · cableo (3 stubs core) ─────────────────────────
export { signTreatmentCard } from "./signTreatmentCard";
export { saveTreatmentCardDraft } from "./saveTreatmentCardDraft";
export { createOrthoTAD } from "./createOrthoTAD";

// ─── Editor del plan financiero ────────────────────────────────────────
export { updateFinancialPlan } from "./updateFinancialPlan";

// ─── Cierre 100% — eliminar todos los toast.info no-externos ───────────
export { createReferralLetter } from "./createReferralLetter";
export { updateRetentionRegimenConfig } from "./updateRetentionRegimenConfig";
export { updateNpsConfig } from "./updateNpsConfig";
export { scheduleG15Checkpoint } from "./scheduleG15Checkpoint";
export { updateQuoteScenario } from "./updateQuoteScenario";
export { updateOrthoAppliances } from "./updateOrthoAppliances";
