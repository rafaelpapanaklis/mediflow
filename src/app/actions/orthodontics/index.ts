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
