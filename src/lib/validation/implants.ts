// Implants — schemas zod para todas las server actions. Spec §5.

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────
// Helpers comunes
// ─────────────────────────────────────────────────────────────────────

/** FDI válido: dientes permanentes (cuadrantes 1-4, posiciones 1-8). */
export function isValidFdi(n: number): boolean {
  return (
    (n >= 11 && n <= 18) ||
    (n >= 21 && n <= 28) ||
    (n >= 31 && n <= 38) ||
    (n >= 41 && n <= 48)
  );
}

const fdiSchema = z.number().int().refine(isValidFdi, "FDI inválido");
const cuidLikeSchema = z.string().min(1);
const justification20 = z
  .string()
  .min(20, "Justificación debe tener ≥20 caracteres")
  .max(2000);

// ─────────────────────────────────────────────────────────────────────
// Enums (replicados como tuplas para z.enum — Prisma no exporta los
// runtime enums sin la dependencia explícita en el archivo cliente)
// ─────────────────────────────────────────────────────────────────────

export const IMPLANT_BRAND = [
  "STRAUMANN", "NOBEL_BIOCARE", "NEODENT", "MIS", "BIOHORIZONS",
  "ZIMMER_BIOMET", "IMPLANT_DIRECT", "ODONTIT", "OTRO",
] as const;

export const IMPLANT_CONNECTION = [
  "EXTERNAL_HEX", "INTERNAL_HEX", "CONICAL_MORSE", "TRI_CHANNEL", "OTRO",
] as const;

export const IMPLANT_SURFACE = [
  "SLA", "SLActive", "TiUnite", "OsseoSpeed", "LASER_LOK", "OTRO",
] as const;

export const LEKHOLM_ZARB = ["D1", "D2", "D3", "D4"] as const;

export const IMPLANT_STATUS = [
  "PLANNED", "PLACED", "OSSEOINTEGRATING", "UNCOVERED",
  "LOADED_PROVISIONAL", "LOADED_DEFINITIVE", "FUNCTIONAL",
  "COMPLICATION", "FAILED", "REMOVED",
] as const;

export const IMPLANT_PROTOCOL = [
  "ONE_STAGE", "TWO_STAGE",
  "IMMEDIATE_PLACEMENT_DELAYED_LOADING",
  "IMMEDIATE_PLACEMENT_IMMEDIATE_LOADING",
  "DELAYED_PLACEMENT_IMMEDIATE_LOADING",
] as const;

export const ABUTMENT_TYPE = [
  "PREFABRICATED_TI", "CUSTOM_TI", "CUSTOM_ZIRCONIA",
  "MULTI_UNIT_STRAIGHT", "MULTI_UNIT_ANGLED_17", "MULTI_UNIT_ANGLED_30",
  "HEALING_ABUTMENT", "OTRO",
] as const;

export const PROSTHESIS_TYPE = [
  "SCREW_RETAINED_SINGLE", "CEMENT_RETAINED_SINGLE",
  "SCREW_RETAINED_MULTI", "CEMENT_RETAINED_MULTI",
  "OVERDENTURE_LOCATOR", "OVERDENTURE_BAR",
  "ALL_ON_4", "ALL_ON_6", "PROVISIONAL_ACRYLIC",
] as const;

export const PROSTHESIS_MATERIAL = [
  "ZIRCONIA_MONOLITHIC", "PORCELAIN_FUSED_TO_METAL",
  "PORCELAIN_FUSED_TO_ZIRCONIA", "LITHIUM_DISILICATE",
  "ACRYLIC_PROVISIONAL", "PMMA_PROVISIONAL",
  "HYBRID_TITANIUM_ACRYLIC", "OTRO",
] as const;

export const COMPLICATION_TYPE = [
  "PERI_IMPLANT_MUCOSITIS",
  "PERI_IMPLANTITIS_INITIAL", "PERI_IMPLANTITIS_MODERATE", "PERI_IMPLANTITIS_ADVANCED",
  "SCREW_LOOSENING", "ABUTMENT_SCREW_FRACTURE",
  "PROSTHESIS_FRACTURE", "IMPLANT_FRACTURE",
  "NERVE_DAMAGE_TRANSIENT", "NERVE_DAMAGE_PERMANENT",
  "SINUS_PERFORATION", "SINUS_INFECTION",
  "OSSEOINTEGRATION_FAILURE", "AESTHETIC_COMPLICATION", "OTRO",
] as const;

export const ASA_CLASSIFICATION = [
  "ASA_I", "ASA_II", "ASA_III", "ASA_IV", "ASA_V",
] as const;

export const FOLLOWUP_MILESTONE = [
  "M_1_WEEK", "M_2_WEEKS", "M_1_MONTH", "M_3_MONTHS",
  "M_6_MONTHS", "M_12_MONTHS", "M_24_MONTHS",
  "M_5_YEARS", "M_10_YEARS", "UNSCHEDULED",
] as const;

export const CONSENT_TYPE = [
  "SURGERY", "BONE_AUGMENTATION", "QR_PUBLIC",
] as const;

export const SEVERITY = ["leve", "moderada", "severa"] as const;

// ─────────────────────────────────────────────────────────────────────
// 1. createImplant
// ─────────────────────────────────────────────────────────────────────

export const createImplantSchema = z
  .object({
    patientId: cuidLikeSchema,
    toothFdi: fdiSchema,
    brand: z.enum(IMPLANT_BRAND),
    brandCustomName: z.string().min(1).max(120).optional(),
    modelName: z.string().min(1).max(120),
    diameterMm: z.number().min(3.0).max(7.0),
    lengthMm: z.number().min(6.0).max(18.0),
    connectionType: z.enum(IMPLANT_CONNECTION),
    surfaceTreatment: z.enum(IMPLANT_SURFACE).optional(),
    lotNumber: z.string().min(1).max(60),
    manufactureDate: z.coerce.date().optional(),
    expiryDate: z.coerce.date().optional(),
    placedAt: z.coerce.date(),
    placedByDoctorId: cuidLikeSchema,
    protocol: z.enum(IMPLANT_PROTOCOL),
    initialStatus: z.enum(IMPLANT_STATUS).default("PLACED"),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => v.brand !== "OTRO" || (v.brandCustomName && v.brandCustomName.length > 0),
    { message: "brandCustomName requerido cuando brand=OTRO", path: ["brandCustomName"] },
  )
  .refine(
    (v) => !v.manufactureDate || !v.expiryDate || v.manufactureDate < v.expiryDate,
    { message: "manufactureDate debe ser anterior a expiryDate", path: ["expiryDate"] },
  );

// ─────────────────────────────────────────────────────────────────────
// 2. updateImplantTraceability — COFEPRIS clase III
// ─────────────────────────────────────────────────────────────────────

export const updateImplantTraceabilitySchema = z.object({
  implantId: cuidLikeSchema,
  field: z.enum(["brand", "lotNumber", "placedAt"]),
  newValue: z.union([
    z.enum(IMPLANT_BRAND),       // brand
    z.string().min(1).max(60),   // lotNumber
    z.coerce.date(),             // placedAt
  ]),
  newBrandCustomName: z.string().min(1).max(120).optional(),
  justification: justification20,
});

// ─────────────────────────────────────────────────────────────────────
// 3. removeImplant
// ─────────────────────────────────────────────────────────────────────

export const removeImplantSchema = z.object({
  implantId: cuidLikeSchema,
  removalReason: z
    .string()
    .min(20, "Motivo debe tener ≥20 caracteres")
    .max(2000),
  removalSurgeryRecordId: cuidLikeSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 4. createSurgicalRecord
// ─────────────────────────────────────────────────────────────────────

export const createSurgicalRecordSchema = z.object({
  implantId: cuidLikeSchema,
  performedAt: z.coerce.date(),
  asaClassification: z.enum(ASA_CLASSIFICATION),
  prophylaxisAntibiotic: z.boolean().default(false),
  prophylaxisDrug: z.string().max(120).optional(),
  hba1cIfDiabetic: z.number().min(3).max(20).optional(),
  insertionTorqueNcm: z.number().int().min(5).max(100),
  isqMesiodistal: z.number().int().min(30).max(90),
  isqVestibulolingual: z.number().int().min(30).max(90),
  boneDensity: z.enum(LEKHOLM_ZARB),
  ridgeWidthMm: z.number().min(2).max(15).optional(),
  ridgeHeightMm: z.number().min(4).max(30).optional(),
  flapType: z.string().min(1).max(120),
  drillingProtocol: z.string().min(1).max(120),
  healingAbutmentLot: z.string().min(1).max(60).optional(),
  healingAbutmentDiameterMm: z.number().min(3).max(8).optional(),
  healingAbutmentHeightMm: z.number().min(1).max(15).optional(),
  sutureMaterial: z.string().max(120).optional(),
  sutureRemovalScheduledAt: z.coerce.date().optional(),
  intraoperativePhotoFileId: cuidLikeSchema.optional(),
  postOpInstructions: z.string().max(4000).optional(),
  durationMinutes: z.number().int().min(5).max(720),
  complications: z.string().max(4000).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 5. updateImplantStatus
// ─────────────────────────────────────────────────────────────────────

export const updateImplantStatusSchema = z.object({
  implantId: cuidLikeSchema,
  newStatus: z.enum(IMPLANT_STATUS),
  reason: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 6. createHealingPhase
// ─────────────────────────────────────────────────────────────────────

export const createHealingPhaseSchema = z.object({
  implantId: cuidLikeSchema,
  startedAt: z.coerce.date(),
  expectedDurationWeeks: z.number().int().min(4).max(40),
  isqAt2Weeks: z.number().int().min(0).max(100).optional(),
  isqAt4Weeks: z.number().int().min(0).max(100).optional(),
  isqAt8Weeks: z.number().int().min(0).max(100).optional(),
  isqLatest: z.number().int().min(0).max(100).optional(),
  isqLatestAt: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 7. createSecondStageSurgery
// ─────────────────────────────────────────────────────────────────────

export const createSecondStageSurgerySchema = z.object({
  implantId: cuidLikeSchema,
  performedAt: z.coerce.date(),
  technique: z.string().min(1).max(120),
  healingAbutmentLot: z.string().min(1).max(60),
  healingAbutmentDiameterMm: z.number().min(3).max(8),
  healingAbutmentHeightMm: z.number().min(1).max(15),
  isqAtUncovering: z.number().int().min(0).max(100).optional(),
  durationMinutes: z.number().int().min(5).max(180),
  notes: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 8. createProstheticPhase  (dispara generateImplantPassport en server)
// ─────────────────────────────────────────────────────────────────────

export const createProstheticPhaseSchema = z.object({
  implantId: cuidLikeSchema,
  abutmentType: z.enum(ABUTMENT_TYPE),
  abutmentBrand: z.string().max(120).optional(),
  abutmentLot: z.string().min(1).max(60),
  abutmentDiameterMm: z.number().min(3).max(8).optional(),
  abutmentHeightMm: z.number().min(1).max(15).optional(),
  abutmentAngulationDeg: z.number().int().min(0).max(45).optional(),
  abutmentTorqueNcm: z.number().int().min(5).max(60),
  prosthesisType: z.enum(PROSTHESIS_TYPE),
  prosthesisMaterial: z.enum(PROSTHESIS_MATERIAL),
  prosthesisLabName: z.string().min(1).max(120),
  prosthesisLabLot: z.string().min(1).max(60),
  screwLot: z.string().max(60).optional(),
  screwTorqueNcm: z.number().int().min(5).max(60).optional(),
  immediateLoading: z.boolean().default(false),
  provisionalDeliveredAt: z.coerce.date().optional(),
  definitiveDeliveredAt: z.coerce.date().optional(),
  prosthesisDeliveredAt: z.coerce.date(),
  occlusionScheme: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 9. createComplication
// ─────────────────────────────────────────────────────────────────────

export const createComplicationSchema = z.object({
  implantId: cuidLikeSchema,
  detectedAt: z.coerce.date(),
  type: z.enum(COMPLICATION_TYPE),
  severity: z.enum(SEVERITY),
  description: z.string().min(10).max(4000),
  bopAtDiagnosis: z.boolean().optional(),
  pdMaxAtDiagnosisMm: z.number().min(0).max(15).optional(),
  suppurationAtDiagnosis: z.boolean().optional(),
  radiographicBoneLossMm: z.number().min(0).max(15).optional(),
  treatmentPlan: z.string().max(4000).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 10. createFollowUp
// ─────────────────────────────────────────────────────────────────────

export const createFollowUpSchema = z
  .object({
    implantId: cuidLikeSchema,
    milestone: z.enum(FOLLOWUP_MILESTONE),
    scheduledAt: z.coerce.date().optional(),
    performedAt: z.coerce.date().optional(),
    bopPresent: z.boolean().optional(),
    pdMaxMm: z.number().min(0).max(15).optional(),
    suppuration: z.boolean().optional(),
    mobility: z.boolean().optional(),
    occlusionStable: z.boolean().optional(),
    radiographicBoneLossMm: z.number().min(0).max(15).optional(),
    meetsAlbrektssonCriteria: z.boolean().optional(),
    radiographFileId: cuidLikeSchema.optional(),
    nextControlAt: z.coerce.date().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => v.scheduledAt || v.performedAt, {
    message: "Debe especificar scheduledAt o performedAt",
    path: ["scheduledAt"],
  });

// ─────────────────────────────────────────────────────────────────────
// 11. createImplantConsent
// ─────────────────────────────────────────────────────────────────────

export const createImplantConsentSchema = z.object({
  implantId: cuidLikeSchema,
  patientId: cuidLikeSchema,
  doctorId: cuidLikeSchema,
  consentType: z.enum(CONSENT_TYPE),
  text: z.string().min(100).max(20000),
  acceptedRisks: z.record(z.string(), z.unknown()).optional(),
  signedAt: z.coerce.date().optional(),
  patientSignatureImage: z.string().max(500_000).optional(),
  signedFileId: cuidLikeSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 12. generateImplantPassport
// ─────────────────────────────────────────────────────────────────────

export const generateImplantPassportSchema = z.object({
  implantId: cuidLikeSchema,
  patientPhotoFileId: cuidLikeSchema.optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 13. exportSurgicalReportPdf
// ─────────────────────────────────────────────────────────────────────

export const exportSurgicalReportSchema = z.object({
  implantId: cuidLikeSchema,
});

// ─────────────────────────────────────────────────────────────────────
// 14. exportImplantPlanPdf
// ─────────────────────────────────────────────────────────────────────

export const exportImplantPlanSchema = z.object({
  implantId: cuidLikeSchema.optional(),
  patientId: cuidLikeSchema.optional(),
}).refine((v) => v.implantId || v.patientId, {
  message: "Se requiere implantId o patientId",
});

// ─────────────────────────────────────────────────────────────────────
// 15. createPeriImplantAssessment (STUB)
// ─────────────────────────────────────────────────────────────────────

export const createPeriImplantAssessmentSchema = z.object({
  implantId: cuidLikeSchema,
  bopPresent: z.boolean().optional(),
  pdMaxMm: z.number().min(0).max(15).optional(),
  suppurationPresent: z.boolean().optional(),
  radiographicBoneLossMm: z.number().min(0).max(15).optional(),
  notes: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// 16. enableQrPublicAccess
// ─────────────────────────────────────────────────────────────────────

export const enableQrPublicAccessSchema = z.object({
  implantId: cuidLikeSchema,
  qrConsentId: cuidLikeSchema,
});

// ─────────────────────────────────────────────────────────────────────
// Tipos derivados
// ─────────────────────────────────────────────────────────────────────

export type CreateImplantInput = z.infer<typeof createImplantSchema>;
export type UpdateImplantTraceabilityInput = z.infer<typeof updateImplantTraceabilitySchema>;
export type RemoveImplantInput = z.infer<typeof removeImplantSchema>;
export type CreateSurgicalRecordInput = z.infer<typeof createSurgicalRecordSchema>;
export type UpdateImplantStatusInput = z.infer<typeof updateImplantStatusSchema>;
export type CreateHealingPhaseInput = z.infer<typeof createHealingPhaseSchema>;
export type CreateSecondStageSurgeryInput = z.infer<typeof createSecondStageSurgerySchema>;
export type CreateProstheticPhaseInput = z.infer<typeof createProstheticPhaseSchema>;
export type CreateComplicationInput = z.infer<typeof createComplicationSchema>;
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;
export type CreateImplantConsentInput = z.infer<typeof createImplantConsentSchema>;
export type GenerateImplantPassportInput = z.infer<typeof generateImplantPassportSchema>;
export type ExportSurgicalReportInput = z.infer<typeof exportSurgicalReportSchema>;
export type ExportImplantPlanInput = z.infer<typeof exportImplantPlanSchema>;
export type CreatePeriImplantAssessmentInput = z.infer<typeof createPeriImplantAssessmentSchema>;
export type EnableQrPublicAccessInput = z.infer<typeof enableQrPublicAccessSchema>;
