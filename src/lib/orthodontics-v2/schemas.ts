// Schemas zod del módulo Ortodoncia v2 · validación entrada de server actions.
// SPEC.md §1.4 verbatim, con extensiones para los modelos que el SPEC no
// detalla (case, plan, retention, etc.).

import { z } from "zod";

// Enums duplicados como zod-strings para no acoplar con Prisma client (que se
// regenera y puede causar drift entre type-runtime y type-static).
const AngleClassEnum = z.enum(["I", "II_DIV1", "II_DIV2", "III", "COMBO"]);
const OpenBiteEnum = z.enum(["NONE", "ANTERIOR", "POSTERIOR", "BOTH"]);
const CrossBiteEnum = z.enum([
  "NONE",
  "ANTERIOR",
  "LATERAL_R",
  "LATERAL_L",
  "POSTERIOR_R",
  "POSTERIOR_L",
  "BILATERAL",
]);
const FacialProfileEnum = z.enum(["CONCAVE", "STRAIGHT", "CONVEX"]);
const SkeletalPatternEnum = z.enum(["BRACHY", "MESO", "DOLICHO"]);
const PhaseEnumZ = z.enum([
  "ALIGNMENT",
  "LEVELING",
  "SPACE_CLOSE",
  "DETAIL",
  "FINISHING",
  "RETENTION",
]);
const ArchMaterialEnum = z.enum(["NITI", "SS", "TMA", "BETA_TI", "ESTHETIC", "OTHER"]);
const ArchStatusEnum = z.enum(["FUTURE", "CURRENT", "PAST", "SKIPPED"]);
const VisitTypeEnum = z.enum([
  "INSTALLATION",
  "CONTROL",
  "EMERGENCY",
  "DEBONDING",
  "RETAINER_FIT",
  "FOLLOWUP",
]);
const RetainerKindEnum = z.enum([
  "NONE",
  "HAWLEY",
  "ESSIX",
  "FIXED_3_3",
  "FIXED_EXTENDED",
  "CLEAR_NIGHT",
]);
const DocumentKindEnum = z.enum(["CONSENT", "REFERRAL_LETTER", "LAB_ORDER", "OTHER"]);
const OrthoLabOrderStatusEnum = z.enum(["DRAFT", "SENT", "RECEIVED", "CANCELLED"]);
const CaseStatusEnum = z.enum([
  "DRAFT",
  "EVAL",
  "ACCEPTED",
  "ACTIVE",
  "PAUSED",
  "DEBONDING",
  "RETENTION",
  "COMPLETED",
]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. DIAGNOSIS · SPEC §1.4 verbatim
// ─────────────────────────────────────────────────────────────────────────────

export const DiagnosisInputSchema = z.object({
  angleClass: AngleClassEnum,
  subCaninoR: AngleClassEnum.optional(),
  subCaninoL: AngleClassEnum.optional(),
  subMolarR: AngleClassEnum.optional(),
  subMolarL: AngleClassEnum.optional(),
  overjetMm: z.number().min(0).max(20).optional(),
  overbiteMm: z.number().min(0).max(15).optional(),
  openBite: OpenBiteEnum,
  crossBite: CrossBiteEnum,
  crowdingMaxMm: z.number().min(0).max(15).optional(),
  crowdingMandMm: z.number().min(0).max(15).optional(),
  diastemas: z.array(
    z.object({
      teeth: z.tuple([
        z.number().int().min(11).max(48),
        z.number().int().min(11).max(48),
      ]),
      mm: z.number().min(0.1).max(10),
    }),
  ),
  midlineDeviation: z.number().min(-10).max(10).optional(),
  facialProfile: FacialProfileEnum,
  skeletalPattern: SkeletalPatternEnum,
  skeletalIssues: z.array(z.string().min(2).max(60)).max(8),
  tmjFindings: z.object({
    noise: z.boolean(),
    pain: z.boolean(),
    deflexionMm: z.number().min(0).max(10).optional(),
    openingMm: z.number().min(0).max(80).optional(),
  }),
  habits: z.array(z.string()).max(10),
  narrative: z.string().max(5000),
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TREATMENT PLAN
// ─────────────────────────────────────────────────────────────────────────────

export const PlanInputSchema = z.object({
  appliances: z.array(z.string()).max(8),
  extractions: z.array(z.number().int().min(11).max(48)).max(8),
  elastics: z.record(z.unknown()),
  expanders: z.record(z.unknown()),
  tads: z.record(z.unknown()),
  objectives: z.array(z.string().max(200)).max(20),
  notes: z.string().max(5000),
  iprPlan: z.record(z.number().min(0).max(1)),
});

// Base sin .refine() para que se pueda usar `.partial()` en updates.
export const ArchInputBase = z.object({
  phase: PhaseEnumZ,
  material: ArchMaterialEnum,
  gauge: z
    .string()
    .regex(/^\.\d{3}(\s?x\s?\.\d{3})?$/, "Formato: .016 o .016x.022"),
  durationW: z.number().int().min(1).max(52),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  notes: z.string().max(500).optional(),
});

export const ArchInputSchema = ArchInputBase.refine(
  (d) => !d.endDate || !d.startDate || d.endDate > d.startDate,
  { message: "endDate > startDate" },
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. FINANCIAL · SPEC §1.4 con validación enganche+meses*monthly ≈ total
// ─────────────────────────────────────────────────────────────────────────────

export const FinancialPlanInputSchema = z
  .object({
    total: z.coerce.number().min(1).max(1_000_000),
    downPayment: z.coerce.number().min(0).max(1_000_000),
    months: z.coerce.number().int().min(1).max(120),
    monthly: z.coerce.number().min(0).max(1_000_000),
    startDate: z.date(),
    scenarios: z.array(z.record(z.unknown())).max(3).optional(),
  })
  .refine(
    (d) => Math.abs(d.total - (d.downPayment + d.monthly * d.months)) <= 10,
    {
      message: "Total != enganche + (mensual × meses) ± $10",
      path: ["total"],
    },
  );

// ─────────────────────────────────────────────────────────────────────────────
// 4. TREATMENT CARD · SPEC §1.4 verbatim
// ─────────────────────────────────────────────────────────────────────────────

export const TreatmentCardInputSchema = z.object({
  appointmentId: z.string().cuid().optional(),
  visitDate: z.date().max(new Date(), "No futuro"),
  visitType: VisitTypeEnum,
  templateUsed: z.string().max(100).optional(),
  archPlacedId: z.string().cuid().optional(),
  ligColor: z.string().max(40).optional(),
  ligKind: z.string().max(40).optional(),
  activations: z.array(z.string()).max(20),
  elasticUse: z
    .object({
      type: z.string(),
      prescribedHours: z.string(),
      reportedCompliance: z.number().min(0).max(100),
    })
    .optional(),
  bracketsLost: z.array(z.number().int().min(11).max(48)).max(32),
  iprDoneDelta: z.record(z.number().min(0).max(1)).optional(),
  soap: z.object({
    s: z.string().max(2000),
    o: z.string().max(2000),
    a: z.string().max(2000),
    p: z.string().max(2000),
  }),
  homeInstr: z.string().max(3000),
  nextSuggestedAt: z.date().min(new Date(), "Próxima cita en futuro").optional(),
  linkedPhotoSet: z.string().cuid().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. LAB ORDER · SPEC §1.4
// ─────────────────────────────────────────────────────────────────────────────

export const LabOrderInputSchema = z.object({
  itemCode: z.string().min(2).max(60),
  itemLabel: z.string().min(2).max(120),
  labPartner: z.string().min(2).max(80),
  trackingCode: z.string().max(80).optional(),
  status: OrthoLabOrderStatusEnum,
  notes: z.string().max(500).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. REFERRAL CODE · regex SPEC
// ─────────────────────────────────────────────────────────────────────────────

export const ReferralCodeSchema = z
  .string()
  .regex(/^[A-Z0-9]{4,12}$/, "Solo A-Z 0-9, 4-12 chars");

// ─────────────────────────────────────────────────────────────────────────────
// 7. RETENTION
// ─────────────────────────────────────────────────────────────────────────────

export const RetentionInputSchema = z.object({
  retUpper: RetainerKindEnum,
  retLower: RetainerKindEnum,
  fixedGauge: z.string().max(40).optional(),
  regimen: z.string().max(2000),
  checkpoints: z.array(z.date()).max(20),
  referralCode: ReferralCodeSchema,
  referralReward: z.object({
    kind: z.string().min(1).max(40),
    label: z.string().min(1).max(80),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. CASE LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

export const CreateCaseInputSchema = z.object({
  patientId: z.string().cuid(),
  caseCode: z.string().max(40).optional(),
});

export const UpdateCaseStatusSchema = z.object({
  caseId: z.string().cuid(),
  status: CaseStatusEnum,
});

export const MarkDebondingSchema = z.object({
  caseId: z.string().cuid(),
  date: z.date(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. PHOTOS
// ─────────────────────────────────────────────────────────────────────────────

export const CreatePhotoSetSchema = z.object({
  caseId: z.string().cuid(),
  stageCode: z.string().min(1).max(20).regex(/^T\d+$|^CONTROL$/i, "T0, T1, T2... o CONTROL"),
  capturedAt: z.date(),
});

export const AnnotationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("arrow"),
    pts: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    color: z.string().optional(),
    text: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("circle"),
    cx: z.number(),
    cy: z.number(),
    r: z.number().min(1),
    color: z.string().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    x: z.number(),
    y: z.number(),
    text: z.string().max(200),
    color: z.string().optional(),
  }),
]);

export const MeasurementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ruler"),
    pts: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    mm: z.number().optional(),
  }),
  z.object({
    kind: z.literal("angle"),
    pts: z.tuple([
      z.tuple([z.number(), z.number()]),
      z.tuple([z.number(), z.number()]),
      z.tuple([z.number(), z.number()]),
    ]),
    deg: z.number().optional(),
  }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// 10. CATÁLOGOS EXTENSIBLES
// ─────────────────────────────────────────────────────────────────────────────

export const ApplianceTypeInputSchema = z.object({
  code: z.string().min(1).max(40),
  label: z.string().min(2).max(80),
  category: z.string().min(2).max(60),
});

export const SaveTemplateInputSchema = z.object({
  caseId: z.string().cuid(),
  name: z.string().min(2).max(120),
  description: z.string().max(300).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

export const GenerateConsentSchema = z.object({
  caseId: z.string().cuid(),
  templateId: z.string().min(1).max(60),
});

export const ReferralInputSchema = z.object({
  caseId: z.string().cuid(),
  to: z.string().min(2).max(200),
  reason: z.string().min(2).max(500),
  notes: z.string().max(2000).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. CROSS-MODULE
// ─────────────────────────────────────────────────────────────────────────────

export const SendWhatsAppSchema = z.object({
  caseId: z.string().cuid(),
  body: z.string().min(1).max(3000),
  templateId: z.string().max(60).optional(),
});
