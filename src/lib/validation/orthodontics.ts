// Orthodontics — schemas zod para las 15 server actions. SPEC §5.1.

import { z } from "zod";

// ─── Constantes (tuplas as const para z.enum sin importar runtime Prisma) ──

const ANGLE_CLASS = [
  "CLASS_I", "CLASS_II_DIV_1", "CLASS_II_DIV_2", "CLASS_III", "ASYMMETRIC",
] as const;

const ORTHO_TECHNIQUE = [
  "METAL_BRACKETS", "CERAMIC_BRACKETS", "SELF_LIGATING_METAL",
  "SELF_LIGATING_CERAMIC", "LINGUAL_BRACKETS", "CLEAR_ALIGNERS", "HYBRID",
] as const;

const ANCHORAGE_TYPE = ["MAXIMUM", "MODERATE", "MINIMUM", "COMPOUND"] as const;

const ORTHO_PHASE_KEY = [
  "ALIGNMENT", "LEVELING", "SPACE_CLOSURE", "DETAILS", "FINISHING", "RETENTION",
] as const;

const ORTHO_TREATMENT_STATUS = [
  "PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION", "COMPLETED", "DROPPED_OUT",
] as const;

const ORTHO_PHOTO_SET_TYPE = ["T0", "T1", "T2", "CONTROL"] as const;

const ORTHO_PHOTO_VIEW = [
  "EXTRA_FRONTAL", "EXTRA_PROFILE", "EXTRA_SMILE",
  "INTRA_FRONTAL_OCCLUSION", "INTRA_LATERAL_RIGHT", "INTRA_LATERAL_LEFT",
  "INTRA_OCCLUSAL_UPPER", "INTRA_OCCLUSAL_LOWER",
] as const;

const HABIT_TYPE = [
  "DIGITAL_SUCKING", "MOUTH_BREATHING", "TONGUE_THRUSTING", "BRUXISM",
  "NAIL_BITING", "LIP_BITING", "OTHER",
] as const;

const DENTAL_PHASE = ["DECIDUOUS", "MIXED_EARLY", "MIXED_LATE", "PERMANENT"] as const;

const TREATMENT_OBJECTIVE = [
  "AESTHETIC_ONLY", "FUNCTIONAL_ONLY", "AESTHETIC_AND_FUNCTIONAL",
] as const;

const ORTHO_CONSENT_TYPE = [
  "TREATMENT", "FINANCIAL", "MINOR_ASSENT", "PHOTO_USE",
] as const;

const CONTROL_ATTENDANCE = ["ATTENDED", "RESCHEDULED", "NO_SHOW"] as const;

const ADJUSTMENT_TYPE = [
  "WIRE_CHANGE", "BRACKET_REPOSITION", "ELASTIC_CHANGE",
  "NEW_ALIGNERS_DELIVERED", "IPR", "BUTTON_PLACEMENT",
  "ATTACHMENT_PLACEMENT", "HYGIENE_REINFORCEMENT", "OTHER",
] as const;

const ORTHO_PAYMENT_METHOD = [
  "CASH", "DEBIT_CARD", "CREDIT_CARD", "BANK_TRANSFER", "CHECK", "WALLET",
] as const;

const DIGITAL_RECORD_TYPE = ["CEPH_ANALYSIS_PDF", "SCAN_STL"] as const;

// ─── FDI helper (compartido con perio/endo) ─────────────────────────────────

function isValidFdi(n: number): boolean {
  return (
    (n >= 11 && n <= 18) ||
    (n >= 21 && n <= 28) ||
    (n >= 31 && n <= 38) ||
    (n >= 41 && n <= 48)
  );
}

const fdiSchema = z
  .number()
  .int()
  .refine(isValidFdi, "FDI inválido (rango 11-48 sin terceros molares fuera del cuadrante)");

// ─── 1-2. Diagnóstico (create + update) ─────────────────────────────────────

export const createDiagnosisSchema = z.object({
  patientId: z.string().min(1),
  angleClassRight: z.enum(ANGLE_CLASS),
  angleClassLeft: z.enum(ANGLE_CLASS),
  overbiteMm: z.number().min(-10).max(15),
  overbitePercentage: z.number().int().min(0).max(100),
  overjetMm: z.number().min(-5).max(20),
  midlineDeviationMm: z.number().min(-10).max(10).optional().nullable(),
  crossbite: z.boolean().default(false),
  crossbiteDetails: z.string().max(500).optional().nullable(),
  openBite: z.boolean().default(false),
  openBiteDetails: z.string().max(500).optional().nullable(),
  crowdingUpperMm: z.number().min(0).max(20).optional().nullable(),
  crowdingLowerMm: z.number().min(0).max(20).optional().nullable(),
  etiologySkeletal: z.boolean().default(false),
  etiologyDental: z.boolean().default(false),
  etiologyFunctional: z.boolean().default(false),
  etiologyNotes: z.string().max(1000).optional().nullable(),
  habits: z.array(z.enum(HABIT_TYPE)).default([]),
  habitsDescription: z.string().max(1000).optional().nullable(),
  dentalPhase: z.enum(DENTAL_PHASE),
  tmjPainPresent: z.boolean().default(false),
  tmjClickingPresent: z.boolean().default(false),
  tmjNotes: z.string().max(500).optional().nullable(),
  initialPhotoSetId: z.string().optional().nullable(),
  initialCephFileId: z.string().optional().nullable(),
  initialScanFileId: z.string().optional().nullable(),
  clinicalSummary: z
    .string()
    .min(40, "El resumen clínico debe tener al menos 40 caracteres")
    .max(5000),
});

export const updateDiagnosisSchema = createDiagnosisSchema.partial().extend({
  diagnosisId: z.string().min(1),
});

// ─── 3-5. Plan de tratamiento ───────────────────────────────────────────────

export const createTreatmentPlanSchema = z.object({
  diagnosisId: z.string().min(1),
  patientId: z.string().min(1),
  technique: z.enum(ORTHO_TECHNIQUE),
  techniqueNotes: z.string().max(1000).optional().nullable(),
  estimatedDurationMonths: z.number().int().min(3).max(60),
  startDate: z.string().datetime().optional().nullable(),
  installedAt: z.string().datetime().optional().nullable(),
  totalCostMxn: z.number().positive().max(10_000_000),
  anchorageType: z.enum(ANCHORAGE_TYPE),
  anchorageNotes: z.string().max(500).optional().nullable(),
  extractionsRequired: z.boolean().default(false),
  extractionsTeethFdi: z.array(fdiSchema).default([]),
  iprRequired: z.boolean().default(false),
  tadsRequired: z.boolean().default(false),
  treatmentObjectives: z.enum(TREATMENT_OBJECTIVE),
  patientGoals: z.string().max(1000).optional().nullable(),
  retentionPlanText: z.string().min(20).max(2000),
  signedTreatmentConsentFileId: z.string().optional().nullable(),
});

export const updateTreatmentPlanSchema = createTreatmentPlanSchema.partial().extend({
  treatmentPlanId: z.string().min(1),
  status: z.enum(ORTHO_TREATMENT_STATUS).optional(),
  onHoldReason: z.string().max(500).optional().nullable(),
  droppedOutReason: z
    .string()
    .min(20, "Si el paciente abandona, justifica el motivo (≥20 caracteres)")
    .max(2000)
    .optional()
    .nullable(),
});

export const advanceTreatmentPhaseSchema = z.object({
  treatmentPlanId: z.string().min(1),
  toPhase: z.enum(ORTHO_PHASE_KEY),
  notes: z.string().max(500).optional().nullable(),
});

// ─── 6-8. Plan de pagos ─────────────────────────────────────────────────────

export const createPaymentPlanSchema = z.object({
  treatmentPlanId: z.string().min(1),
  patientId: z.string().min(1),
  totalAmount: z.number().positive().max(10_000_000),
  initialDownPayment: z.number().min(0).max(10_000_000),
  installmentAmount: z.number().positive().max(10_000_000),
  installmentCount: z.number().int().min(1).max(60),
  startDate: z.string().datetime(),
  paymentDayOfMonth: z.number().int().min(1).max(28),
  preferredPaymentMethod: z.enum(ORTHO_PAYMENT_METHOD),
  signedFinancialAgreementFileId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const recordInstallmentPaymentSchema = z.object({
  installmentId: z.string().min(1),
  paidAt: z.string().datetime(),
  amountPaid: z.number().positive().max(10_000_000),
  paymentMethod: z.enum(ORTHO_PAYMENT_METHOD),
  receiptFileId: z.string().optional().nullable(),
  /**
   * Justificación obligatoria si paidAt cae fuera del rango
   * [dueDate - 60d, now()]. La action server-side valida y rechaza si <20.
   * SPEC §1.12 + §13.5.
   */
  backdatingJustification: z.string().max(2000).optional().nullable(),
});

export const recalculatePaymentStatusSchema = z.object({
  paymentPlanId: z.string().min(1),
});

// ─── 9-10. Fotos ────────────────────────────────────────────────────────────

export const createPhotoSetSchema = z.object({
  treatmentPlanId: z.string().min(1),
  patientId: z.string().min(1),
  setType: z.enum(ORTHO_PHOTO_SET_TYPE),
  capturedAt: z.string().datetime(),
  monthInTreatment: z.number().int().min(0).max(120).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const uploadPhotoToSetSchema = z.object({
  setId: z.string().min(1),
  view: z.enum(ORTHO_PHOTO_VIEW),
  fileId: z.string().min(1),
});

// ─── 11. Control mensual ────────────────────────────────────────────────────

export const createControlAppointmentSchema = z.object({
  treatmentPlanId: z.string().min(1),
  patientId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  performedAt: z.string().datetime().optional().nullable(),
  monthInTreatment: z.number().int().min(0).max(120),
  attendance: z.enum(CONTROL_ATTENDANCE).default("ATTENDED"),
  hygieneScore: z.number().int().min(0).max(100).optional().nullable(),
  bracketsLoose: z.number().int().min(0).max(32).optional().nullable(),
  bracketsBroken: z.number().int().min(0).max(32).optional().nullable(),
  appliancesIntact: z.boolean().optional().nullable(),
  patientReportsPain: z.boolean().default(false),
  patientPainNotes: z.string().max(1000).optional().nullable(),
  adjustments: z.array(z.enum(ADJUSTMENT_TYPE)).default([]),
  adjustmentNotes: z.string().max(1000).optional().nullable(),
  photoSetId: z.string().optional().nullable(),
  nextAppointmentAt: z.string().datetime().optional().nullable(),
  nextAppointmentNotes: z.string().max(500).optional().nullable(),
});

// ─── 12. Cefalo / STL ───────────────────────────────────────────────────────

export const linkDigitalRecordSchema = z.object({
  treatmentPlanId: z.string().min(1),
  patientId: z.string().min(1),
  recordType: z.enum(DIGITAL_RECORD_TYPE),
  fileId: z.string().min(1),
  capturedAt: z.string().datetime(),
  notes: z.string().max(1000).optional().nullable(),
});

// ─── 13. Consentimientos ────────────────────────────────────────────────────

export const createOrthodonticConsentSchema = z.object({
  treatmentPlanId: z.string().min(1),
  patientId: z.string().min(1),
  consentType: z.enum(ORTHO_CONSENT_TYPE),
  signedAt: z.string().datetime(),
  signerName: z.string().min(2).max(200),
  signerRelationship: z.string().max(50).optional().nullable(),
  patientSignatureImage: z.string().optional().nullable(),
  guardianSignatureImage: z.string().optional().nullable(),
  signedFileId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

// ─── 14-15. PDF exports ─────────────────────────────────────────────────────

export const exportTreatmentPlanPdfSchema = z.object({
  treatmentPlanId: z.string().min(1),
});

export const exportFinancialAgreementPdfSchema = z.object({
  paymentPlanId: z.string().min(1),
});

// ─── Inferred types ─────────────────────────────────────────────────────────

export type CreateDiagnosisInput = z.infer<typeof createDiagnosisSchema>;
export type UpdateDiagnosisInput = z.infer<typeof updateDiagnosisSchema>;
export type CreateTreatmentPlanInput = z.infer<typeof createTreatmentPlanSchema>;
export type UpdateTreatmentPlanInput = z.infer<typeof updateTreatmentPlanSchema>;
export type AdvanceTreatmentPhaseInput = z.infer<typeof advanceTreatmentPhaseSchema>;
export type CreatePaymentPlanInput = z.infer<typeof createPaymentPlanSchema>;
export type RecordInstallmentPaymentInput = z.infer<typeof recordInstallmentPaymentSchema>;
export type RecalculatePaymentStatusInput = z.infer<typeof recalculatePaymentStatusSchema>;
export type CreatePhotoSetInput = z.infer<typeof createPhotoSetSchema>;
export type UploadPhotoToSetInput = z.infer<typeof uploadPhotoToSetSchema>;
export type CreateControlAppointmentInput = z.infer<typeof createControlAppointmentSchema>;
export type LinkDigitalRecordInput = z.infer<typeof linkDigitalRecordSchema>;
export type CreateOrthodonticConsentInput = z.infer<typeof createOrthodonticConsentSchema>;
export type ExportTreatmentPlanPdfInput = z.infer<typeof exportTreatmentPlanPdfSchema>;
export type ExportFinancialAgreementPdfInput = z.infer<typeof exportFinancialAgreementPdfSchema>;
