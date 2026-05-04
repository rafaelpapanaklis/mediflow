// Periodontics — schemas zod para todas las server actions. SPEC §5.1

import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────
// Constantes (replicadas como tuplas as const para z.enum sin importar
// runtime de Prisma desde el cliente).
// ─────────────────────────────────────────────────────────────────────

export const SITE_POSITION = ["MV", "MB", "DV", "DL", "ML", "MB_PAL"] as const;

export const PERIODONTAL_RECORD_TYPE = [
  "INICIAL", "PRE_TRATAMIENTO", "POST_FASE_1", "POST_FASE_2",
  "MANTENIMIENTO", "CIRUGIA_PRE", "CIRUGIA_POST",
] as const;

export const PERIODONTAL_STAGE = [
  "SALUD", "GINGIVITIS", "STAGE_I", "STAGE_II", "STAGE_III", "STAGE_IV",
] as const;

export const PERIODONTAL_GRADE = ["GRADE_A", "GRADE_B", "GRADE_C"] as const;

export const PERIODONTAL_EXTENSION = [
  "LOCALIZADA", "GENERALIZADA", "PATRON_MOLAR_INCISIVO",
] as const;

export const CAIRO_CLASSIFICATION = ["RT1", "RT2", "RT3"] as const;
export const GINGIVAL_PHENOTYPE = ["DELGADO", "GRUESO"] as const;
export const PERIODONTAL_PHASE = ["PHASE_1", "PHASE_2", "PHASE_3", "PHASE_4"] as const;
export const SRP_TECHNIQUE = [
  "SRP_CUADRANTE", "FULL_MOUTH_DISINFECTION", "FULL_MOUTH_SCALING",
] as const;
export const SRP_INSTRUMENTATION = ["MANUAL", "ULTRASONICO", "COMBINADO"] as const;
export const SMOKING_STATUS = ["NO", "MENOR_10", "MAYOR_O_IGUAL_10"] as const;
export const PERIODONTAL_RISK_CATEGORY = ["BAJO", "MODERADO", "ALTO"] as const;
export const PERIODONTAL_SURGERY_TYPE = [
  "COLGAJO_ACCESO", "GINGIVECTOMIA", "RESECTIVA_OSEA", "RTG",
  "INJERTO_GINGIVAL_LIBRE", "INJERTO_TEJIDO_CONECTIVO",
  "TUNELIZACION", "CORONALLY_ADVANCED_FLAP", "OTRO",
] as const;
export const PERI_IMPLANT_STATUS = [
  "SALUD", "MUCOSITIS",
  "PERIIMPLANTITIS_INICIAL", "PERIIMPLANTITIS_MODERADA", "PERIIMPLANTITIS_AVANZADA",
] as const;

// ─────────────────────────────────────────────────────────────────────
// Helpers comunes
// ─────────────────────────────────────────────────────────────────────

/** FDI permanente (cuadrantes 1-4, posiciones 1-8). */
export function isValidFdi(n: number): boolean {
  return (
    (n >= 11 && n <= 18) ||
    (n >= 21 && n <= 28) ||
    (n >= 31 && n <= 38) ||
    (n >= 41 && n <= 48)
  );
}

const fdiSchema = z.number().int().refine(isValidFdi, "FDI inválido (rango 11-48 sin terceros molares fuera del cuadrante)");

// ─────────────────────────────────────────────────────────────────────
// Sitios y dientes
// ─────────────────────────────────────────────────────────────────────

export const SiteSchema = z.object({
  fdi: fdiSchema,
  position: z.enum(SITE_POSITION),
  pdMm: z.number().int().min(0).max(15),
  // recMm: -5 a 15. El SPEC permite valores negativos (sobreposición gingival).
  recMm: z.number().int().min(-5).max(15),
  bop: z.boolean(),
  plaque: z.boolean(),
  suppuration: z.boolean(),
});

export const ToothLevelSchema = z.object({
  fdi: fdiSchema,
  mobility: z.number().int().min(0).max(3),
  furcation: z.number().int().min(0).max(3),
  absent: z.boolean(),
  isImplant: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────
// Server action schemas
// ─────────────────────────────────────────────────────────────────────

export const createPeriodontalRecordSchema = z.object({
  patientId: z.string().min(1),
  recordType: z.enum(PERIODONTAL_RECORD_TYPE),
  sites: z.array(SiteSchema).max(192),
  toothLevel: z.array(ToothLevelSchema).max(32),
  notes: z.string().max(2000).optional().nullable(),
  durationMinutes: z.number().int().positive().max(480).optional().nullable(),
  comparedToRecordId: z.string().optional().nullable(),
});

export const updatePeriodontalRecordSchema = z.object({
  recordId: z.string().min(1),
  notes: z.string().max(2000).optional().nullable(),
  durationMinutes: z.number().int().positive().max(480).optional().nullable(),
});

export const upsertSiteDataSchema = z.object({
  recordId: z.string().min(1),
  site: SiteSchema,
});

export const upsertToothDataSchema = z.object({
  recordId: z.string().min(1),
  tooth: ToothLevelSchema,
});

export const bulkUpsertSiteDataSchema = z.object({
  recordId: z.string().min(1),
  sites: z.array(SiteSchema).min(1).max(192),
});

export const finalizePerioChartSchema = z.object({
  recordId: z.string().min(1),
});

export const classifyPatientSchema = z.object({
  recordId: z.string().min(1),
  modifiers: z.object({
    smokingCigsPerDay: z.number().int().min(0).optional(),
    hba1c: z.number().min(3).max(20).optional(),
    otherFactors: z.array(z.string()).optional(),
  }).default({}),
});

export const overrideClassificationSchema = z.object({
  classificationId: z.string().min(1),
  stage: z.enum(PERIODONTAL_STAGE),
  grade: z.enum(PERIODONTAL_GRADE).nullable(),
  extension: z.enum(PERIODONTAL_EXTENSION).nullable(),
  justification: z.string().min(10, "Justifica la sobrescritura (mínimo 10 caracteres)."),
});

export const createGingivalRecessionSchema = z.object({
  patientId: z.string().min(1),
  toothFdi: fdiSchema,
  surface: z.enum(["vestibular", "lingual"]),
  recessionHeightMm: z.number().min(0).max(20),
  recessionWidthMm: z.number().min(0).max(20),
  keratinizedTissueMm: z.number().min(0).max(20),
  cairoClassification: z.enum(CAIRO_CLASSIFICATION),
  gingivalPhenotype: z.enum(GINGIVAL_PHENOTYPE),
  notes: z.string().max(1000).optional().nullable(),
});

export const createTreatmentPlanSchema = z.object({
  patientId: z.string().min(1),
  currentPhase: z.enum(PERIODONTAL_PHASE).default("PHASE_1"),
  planNotes: z.string().max(2000).optional().nullable(),
});

export const advancePhaseSchema = z.object({
  planId: z.string().min(1),
  toPhase: z.enum(PERIODONTAL_PHASE),
});

export const createSRPSessionSchema = z.object({
  patientId: z.string().min(1),
  planId: z.string().min(1),
  technique: z.enum(SRP_TECHNIQUE),
  instrumentation: z.enum(SRP_INSTRUMENTATION),
  quadrantsCompleted: z.object({
    Q1: z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), notes: z.string().optional() }),
    Q2: z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), notes: z.string().optional() }),
    Q3: z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), notes: z.string().optional() }),
    Q4: z.object({ completed: z.boolean(), completedAt: z.string().datetime().nullable(), notes: z.string().optional() }),
  }),
  anesthesiaUsed: z.boolean(),
  anesthesiaType: z.string().max(120).optional().nullable(),
  durationMinutes: z.number().int().positive().max(480).optional().nullable(),
  observations: z.string().max(2000).optional().nullable(),
});

export const createReevaluationSchema = z.object({
  patientId: z.string().min(1),
  planId: z.string().min(1),
  initialRecordId: z.string().min(1),
  postRecordId: z.string().min(1),
  recommendation: z.string().max(2000).optional().nullable(),
});

export const createRiskAssessmentSchema = z.object({
  patientId: z.string().min(1),
  bopPct: z.number().min(0).max(100),
  residualSites5Plus: z.number().int().min(0),
  lostTeethPerio: z.number().int().min(0).max(32),
  boneLossAgeRatio: z.number().min(0).optional().nullable(),
  smokingStatus: z.enum(SMOKING_STATUS),
  hba1c: z.number().min(3).max(20).optional().nullable(),
});

export const createPeriodontalSurgerySchema = z.object({
  patientId: z.string().min(1),
  planId: z.string().optional().nullable(),
  surgeryType: z.enum(PERIODONTAL_SURGERY_TYPE),
  treatedSites: z.array(z.object({
    fdi: fdiSchema,
    sites: z.array(z.enum(SITE_POSITION)).optional(),
  })),
  biomaterials: z.object({
    membrane: z.string().optional(),
    boneGraft: z.string().optional(),
    connectiveTissue: z.string().optional(),
    growthFactor: z.string().optional(),
    others: z.array(z.string()).optional(),
  }).optional().nullable(),
  sutureType: z.string().max(100).optional().nullable(),
  surgeryDate: z.string().datetime(),
  consentSignedFileId: z.string().optional().nullable(),
  intraoperativeFileId: z.string().optional().nullable(),
});

export const createPeriImplantAssessmentSchema = z.object({
  patientId: z.string().min(1),
  implantId: z.string().optional().nullable(),
  implantFdi: fdiSchema,
  status: z.enum(PERI_IMPLANT_STATUS),
  bop: z.boolean(),
  suppuration: z.boolean(),
  radiographicBoneLossMm: z.number().min(0).max(15).optional().nullable(),
  recommendedTreatment: z.string().max(1000).optional().nullable(),
});

export const signSrpConsentSchema = z.object({
  patientId: z.string().min(1),
  signatureUrl: z.string().min(10),
});

export const signSurgeryConsentSchema = z.object({
  surgeryId: z.string().min(1),
  signatureUrl: z.string().min(10),
});

export const scheduleMaintenanceSchema = z.object({
  patientId: z.string().min(1),
  scheduledAt: z.string().datetime(),
  recallMonthsUsed: z.union([z.literal(3), z.literal(4), z.literal(6)]),
});

export const completeMaintenanceSchema = z.object({
  recordId: z.string().min(1),
});

// Inferred types
export type Site = z.infer<typeof SiteSchema>;
export type ToothLevel = z.infer<typeof ToothLevelSchema>;
export type CreatePerioRecordInput = z.infer<typeof createPeriodontalRecordSchema>;
export type UpsertSiteInput = z.infer<typeof upsertSiteDataSchema>;
export type UpsertToothInput = z.infer<typeof upsertToothDataSchema>;
export type ClassifyPatientInput = z.infer<typeof classifyPatientSchema>;
export type OverrideClassificationInput = z.infer<typeof overrideClassificationSchema>;
export type CreateGingivalRecessionInput = z.infer<typeof createGingivalRecessionSchema>;
export type CreateTreatmentPlanInput = z.infer<typeof createTreatmentPlanSchema>;
export type CreateSRPSessionInput = z.infer<typeof createSRPSessionSchema>;
export type CreateReevaluationInput = z.infer<typeof createReevaluationSchema>;
export type CreateRiskAssessmentInput = z.infer<typeof createRiskAssessmentSchema>;
export type CreatePeriodontalSurgeryInput = z.infer<typeof createPeriodontalSurgerySchema>;
export type CreatePeriImplantAssessmentInput = z.infer<typeof createPeriImplantAssessmentSchema>;
