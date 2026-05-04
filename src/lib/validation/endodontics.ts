// Endodontics — schemas zod para todas las server actions. Spec §5

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

// ─────────────────────────────────────────────────────────────────────
// Enums (replicados como tuplas para z.enum — Prisma no exporta los
// runtime enums sin la dependencia explícita en el archivo cliente)
// ─────────────────────────────────────────────────────────────────────

export const PULPAL_DIAGNOSIS = [
  "PULPA_NORMAL", "PULPITIS_REVERSIBLE",
  "PULPITIS_IRREVERSIBLE_SINTOMATICA", "PULPITIS_IRREVERSIBLE_ASINTOMATICA",
  "NECROSIS_PULPAR", "PREVIAMENTE_TRATADO", "PREVIAMENTE_INICIADO",
] as const;

export const PERIAPICAL_DIAGNOSIS = [
  "TEJIDOS_PERIAPICALES_NORMALES",
  "PERIODONTITIS_APICAL_SINTOMATICA", "PERIODONTITIS_APICAL_ASINTOMATICA",
  "ABSCESO_APICAL_AGUDO", "ABSCESO_APICAL_CRONICO",
  "OSTEITIS_CONDENSANTE",
] as const;

export const VITALITY_TEST_TYPE = [
  "FRIO", "CALOR", "EPT",
  "PERCUSION_VERTICAL", "PERCUSION_HORIZONTAL",
  "PALPACION_APICAL", "MORDIDA_TOOTHSLOOTH",
] as const;

export const VITALITY_RESULT = [
  "POSITIVO", "NEGATIVO", "EXAGERADO", "DIFERIDO", "SIN_RESPUESTA",
] as const;

export const ENDO_TREATMENT_TYPE = [
  "TC_PRIMARIO", "RETRATAMIENTO", "APICECTOMIA",
  "PULPOTOMIA_EMERGENCIA", "TERAPIA_REGENERATIVA",
] as const;

export const ACCESS_TYPE = [
  "CONVENCIONAL", "CONSERVADOR", "RECTIFICACION_PREVIO", "POSTE_RETIRADO",
] as const;

export const INSTRUMENTATION_SYSTEM = [
  "PROTAPER_GOLD", "PROTAPER_NEXT", "WAVEONE_GOLD", "RECIPROC_BLUE",
  "BIORACE", "HYFLEX_EDM", "TRUNATOMY", "MANUAL_KFILES", "OTRO",
] as const;

export const INSTRUMENTATION_TECHNIQUE = [
  "ROTACION_CONTINUA", "RECIPROCACION", "MANUAL", "HIBRIDA",
] as const;

export const IRRIGATION_ACTIVATION = [
  "NINGUNA", "SONICA", "ULTRASONICA", "LASER", "XPF",
] as const;

export const OBTURATION_TECHNIQUE = [
  "CONDENSACION_LATERAL", "CONDENSACION_VERTICAL_CALIENTE",
  "OLA_CONTINUA", "CONO_UNICO",
  "TERMOPLASTICA_INYECTABLE", "BIOCERAMIC_SINGLE_CONE",
] as const;

export const SEALER_TYPE = [
  "AH_PLUS", "MTA_FILLAPEX", "BIOROOT_RCS", "BC_SEALER",
  "TUBLISEAL", "SEALAPEX", "OTRO",
] as const;

export const CANAL_CANONICAL_NAME = [
  "MB", "MB2", "DB", "MV", "DV", "MP", "P",
  "D", "M", "L", "V", "ML", "DL",
  "CONDUCTO_UNICO", "OTRO",
] as const;

export const OBTURATION_QUALITY = [
  "HOMOGENEA", "ADECUADA", "CON_HUECOS", "SOBREOBTURADA", "SUBOBTURADA",
] as const;

export const INTRACANAL_SUBSTANCE = [
  "HIDROXIDO_CALCIO", "CTZ", "LEDERMIX",
  "FORMOCRESOL", "PROPILENGLICOL", "OTRO",
] as const;

export const FOLLOW_UP_MILESTONE = [
  "CONTROL_6M", "CONTROL_12M", "CONTROL_24M", "CONTROL_EXTRA",
] as const;

export const FOLLOW_UP_CONCLUSION = [
  "EXITO", "EN_CURACION", "FRACASO", "INCIERTO",
] as const;

export const RETREATMENT_FAILURE_REASON = [
  "FILTRACION_CORONAL", "INSTRUMENTO_FRACTURADO", "CONDUCTO_NO_TRATADO",
  "SOBREOBTURACION", "SUBOBTURACION", "FRACTURA_RADICULAR",
  "REINFECCION", "DESCONOCIDO",
] as const;

export const RETREATMENT_DIFFICULTY = ["BAJA", "MEDIA", "ALTA"] as const;

export const RETRO_FILLING_MATERIAL = [
  "MTA", "BIOCERAMIC_PUTTY", "SUPER_EBA", "IRM", "OTRO",
] as const;

export const FLAP_TYPE = [
  "OCHSENBEIN_LUEBKE", "SULCULAR", "SEMILUNAR", "PAPILAR",
] as const;

export const POST_OP_RESTORATION_TYPE = [
  "CORONA_PORCELANA_METAL", "CORONA_ZIRCONIA",
  "CORONA_DISILICATO_LITIO", "ONLAY",
  "RESTAURACION_DIRECTA_RESINA",
  "POSTE_FIBRA_CORONA", "POSTE_METALICO_CORONA",
] as const;

// ─────────────────────────────────────────────────────────────────────
// Schemas por server action
// ─────────────────────────────────────────────────────────────────────

export const createDiagnosisSchema = z.object({
  patientId: z.string().min(1),
  toothFdi: fdiSchema,
  pulpalDiagnosis: z.enum(PULPAL_DIAGNOSIS),
  periapicalDiagnosis: z.enum(PERIAPICAL_DIAGNOSIS),
  justification: z.string().max(2000).optional().nullable(),
});

export const updateDiagnosisSchema = createDiagnosisSchema.extend({
  id: z.string().min(1),
});

export const recordVitalitySchema = z.object({
  patientId: z.string().min(1),
  toothFdi: fdiSchema,
  controlTeeth: z.array(z.number().int()).min(1).max(4),
  testType: z.enum(VITALITY_TEST_TYPE),
  result: z.enum(VITALITY_RESULT),
  intensity: z.number().int().min(0).max(10).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const startTreatmentSchema = z.object({
  patientId: z.string().min(1),
  toothFdi: fdiSchema,
  treatmentType: z.enum(ENDO_TREATMENT_TYPE),
  diagnosisId: z.string().optional().nullable(),
  isMultiSession: z.boolean().optional(),
});

// Wizard step schemas (1..4)
export const treatmentStep1Schema = z.object({
  treatmentId: z.string().min(1),
  rubberDamPlaced: z.boolean(),
  accessType: z.enum(ACCESS_TYPE),
});

export const treatmentStep2Schema = z.object({
  treatmentId: z.string().min(1),
  instrumentationSystem: z.enum(INSTRUMENTATION_SYSTEM),
  technique: z.enum(INSTRUMENTATION_TECHNIQUE),
  motorBrand: z.string().max(100).optional().nullable(),
  torqueSettings: z.string().max(100).optional().nullable(),
  rpmSetting: z.number().int().min(50).max(1500).optional().nullable(),
});

export const irrigantSchema = z.object({
  substance: z.string().min(1).max(100),
  concentration: z.string().min(1).max(50),
  volumeMl: z.number().min(0).max(50),
  order: z.number().int().min(1),
});

export const treatmentStep3Schema = z.object({
  treatmentId: z.string().min(1),
  irrigants: z.array(irrigantSchema).min(1).max(8),
  irrigationActivation: z.enum(IRRIGATION_ACTIVATION),
  totalIrrigationMinutes: z.number().int().min(1).max(60).optional().nullable(),
});

export const treatmentStep4Schema = z.object({
  treatmentId: z.string().min(1),
  obturationTechnique: z.enum(OBTURATION_TECHNIQUE),
  sealer: z.enum(SEALER_TYPE),
  masterConePresetIso: z.number().int().optional().nullable(),
  postOpRestorationPlan: z.enum(POST_OP_RESTORATION_TYPE),
  requiresPost: z.boolean(),
  postMaterial: z.string().max(100).optional().nullable(),
  restorationUrgencyDays: z.number().int().min(1).max(90).default(30),
  restorationDoctorId: z.string().optional().nullable(),
});

export const upsertRootCanalSchema = z.object({
  id: z.string().optional().nullable(),
  treatmentId: z.string().min(1),
  canonicalName: z.enum(CANAL_CANONICAL_NAME),
  customLabel: z.string().max(50).optional().nullable(),
  workingLengthMm: z.number().min(5).max(40),
  coronalReferencePoint: z.string().min(1).max(100),
  masterApicalFileIso: z.number().int().min(10).max(80),
  masterApicalFileTaper: z.number().min(0.02).max(0.12),
  apexLocatorReadingMm: z.number().min(5).max(40).optional().nullable(),
  radiographicLengthMm: z.number().min(5).max(40).optional().nullable(),
  apexLocatorBrand: z.string().max(50).optional().nullable(),
  conductometryFileId: z.string().optional().nullable(),
  obturationQuality: z.enum(OBTURATION_QUALITY).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export const recordIntracanalMedSchema = z.object({
  treatmentId: z.string().min(1),
  substance: z.enum(INTRACANAL_SUBSTANCE),
  placedAt: z.string().datetime(),
  expectedRemovalAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const completeTreatmentSchema = z.object({
  treatmentId: z.string().min(1),
});

export const scheduleFollowUpSchema = z.object({
  treatmentId: z.string().min(1),
  milestone: z.enum(FOLLOW_UP_MILESTONE),
  scheduledAt: z.string().datetime(),
});

export const completeFollowUpSchema = z.object({
  followUpId: z.string().min(1),
  performedAt: z.string().datetime(),
  paiScore: z.number().int().min(1).max(5),
  symptomsPresent: z.boolean(),
  conclusion: z.enum(FOLLOW_UP_CONCLUSION),
  recommendedAction: z.string().max(1000).optional().nullable(),
  controlFileId: z.string().optional().nullable(),
});

export const createRetreatmentInfoSchema = z.object({
  treatmentId: z.string().min(1),
  failureReason: z.enum(RETREATMENT_FAILURE_REASON),
  originalTreatmentDate: z.string().datetime().optional().nullable(),
  fracturedInstrumentRecovered: z.boolean().optional(),
  difficulty: z.enum(RETREATMENT_DIFFICULTY).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

export const createApicalSurgerySchema = z.object({
  treatmentId: z.string().min(1),
  interventedRoot: z.string().min(1).max(50),
  resectedRootLengthMm: z.number().min(0.5).max(10),
  retroFillingMaterial: z.enum(RETRO_FILLING_MATERIAL),
  flapType: z.enum(FLAP_TYPE),
  sutureType: z.string().max(50).optional().nullable(),
  postOpControlAt: z.string().datetime().optional().nullable(),
  intraoperativeFileId: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

// Inferred input types (re-exportados para callers).
export type CreateDiagnosisInput = z.infer<typeof createDiagnosisSchema>;
export type UpdateDiagnosisInput = z.infer<typeof updateDiagnosisSchema>;
export type RecordVitalityInput = z.infer<typeof recordVitalitySchema>;
export type StartTreatmentInput = z.infer<typeof startTreatmentSchema>;
export type TreatmentStep1Input = z.infer<typeof treatmentStep1Schema>;
export type TreatmentStep2Input = z.infer<typeof treatmentStep2Schema>;
export type TreatmentStep3Input = z.infer<typeof treatmentStep3Schema>;
export type TreatmentStep4Input = z.infer<typeof treatmentStep4Schema>;
export type UpsertRootCanalInput = z.infer<typeof upsertRootCanalSchema>;
export type RecordIntracanalMedInput = z.infer<typeof recordIntracanalMedSchema>;
export type CompleteFollowUpInput = z.infer<typeof completeFollowUpSchema>;
export type CreateRetreatmentInfoInput = z.infer<typeof createRetreatmentInfoSchema>;
export type CreateApicalSurgeryInput = z.infer<typeof createApicalSurgerySchema>;
