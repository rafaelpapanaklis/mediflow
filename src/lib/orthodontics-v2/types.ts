// Types compartidos del módulo Ortodoncia v2.
//
// Result<T> es el contrato de retorno de toda server action: éxito tipado o
// error con código + mensaje + campo opcional para feedback de formulario.
//
// ViewModels alimentan al UI con datos pre-mapeados (no Prisma directo) para
// que el cliente sea agnóstico al schema.

import type {
  OrthoCase,
  OrthoDiagnosis,
  OrthoTreatmentPlan,
  ArchPlanned,
  PhotoSet,
  Photo,
  TreatmentCard,
  FinancialPlan,
  Installment,
  RetentionPlan,
  OrthoDocument,
  OrthoLabOrder,
  CommunicationLog,
  OrthoTemplate,
  ApplianceType,
  NoteTemplate,
  IndicationTemplate,
  CaseStatus,
  PhaseEnum,
  AngleClass,
  OpenBite,
  CrossBite,
  FacialProfile,
  SkeletalPattern,
  ArchMaterial,
  ArchStatus,
  PhotoKind,
  VisitType,
  InstStatus,
  RetainerKind,
  DocumentKind,
  OrthoLabOrderStatus,
} from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Result<T> · contrato uniforme de server actions
// ─────────────────────────────────────────────────────────────────────────────

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; field?: string } };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: string, message: string, field?: string): Result<never> => ({
  ok: false,
  error: { code, message, field },
});

export const isOk = <T>(r: Result<T>): r is { ok: true; data: T } => r.ok;
export const isFailure = <T>(r: Result<T>): r is { ok: false; error: { code: string; message: string; field?: string } } => !r.ok;

/**
 * Re-wrap un Result fallido a otro tipo. TypeScript no unifica Result<A> con
 * Result<B> aunque sus branches false sean estructuralmente idénticas, así
 * que necesitamos un cast explícito al pasar errores entre helpers.
 *
 * Acepta cualquier `Result<unknown>`; si está en estado ok lanza para que el
 * caller arregle el bug — solo debe llamarse dentro de `if (!r.ok) return reFail(r)`.
 */
export function reFail<T>(r: Result<unknown>): Result<T> {
  if (r.ok) throw new Error("reFail called on success Result");
  return r as Result<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports de enums de Prisma para consumo del cliente sin importar prisma
// ─────────────────────────────────────────────────────────────────────────────

export type {
  OrthoCase,
  OrthoDiagnosis,
  OrthoTreatmentPlan,
  ArchPlanned,
  PhotoSet,
  Photo,
  TreatmentCard,
  FinancialPlan,
  Installment,
  RetentionPlan,
  OrthoDocument,
  OrthoLabOrder,
  CommunicationLog,
  OrthoTemplate,
  ApplianceType,
  NoteTemplate,
  IndicationTemplate,
  CaseStatus,
  PhaseEnum,
  AngleClass,
  OpenBite,
  CrossBite,
  FacialProfile,
  SkeletalPattern,
  ArchMaterial,
  ArchStatus,
  PhotoKind,
  VisitType,
  InstStatus,
  RetainerKind,
  DocumentKind,
  OrthoLabOrderStatus,
};

// ─────────────────────────────────────────────────────────────────────────────
// ViewModels · estructuras serializables (sin tipos Decimal/Date) para SSR→Client
// ─────────────────────────────────────────────────────────────────────────────

export interface OrthoCaseVM {
  id: string;
  caseCode: string;
  status: CaseStatus;
  currentPhase: PhaseEnum | null;
  primaryDoctorId: string;
  startedAt: string | null;
  estimatedEnd: string | null;
  debondedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  patient: { id: string; firstName: string; lastName: string; patientNumber: string };
}

export interface OrthoDiagnosisVM {
  id: string;
  caseId: string;
  angleClass: AngleClass;
  subCaninoR: AngleClass | null;
  subCaninoL: AngleClass | null;
  subMolarR: AngleClass | null;
  subMolarL: AngleClass | null;
  overjetMm: number | null;
  overbiteMm: number | null;
  openBite: OpenBite;
  crossBite: CrossBite;
  crowdingMaxMm: number | null;
  crowdingMandMm: number | null;
  diastemas: Array<{ teeth: [number, number]; mm: number }>;
  midlineDeviation: number | null;
  facialProfile: FacialProfile;
  skeletalPattern: SkeletalPattern;
  skeletalIssues: string[];
  tmjFindings: { noise: boolean; pain: boolean; deflexionMm?: number; openingMm?: number };
  habits: string[];
  narrative: string;
}

export interface ArchVM {
  id: string;
  order: number;
  phase: PhaseEnum;
  material: ArchMaterial;
  gauge: string;
  durationW: number;
  startDate: string | null;
  endDate: string | null;
  status: ArchStatus;
  notes: string | null;
}

export interface TreatmentPlanVM {
  id: string;
  caseId: string;
  appliances: string[];
  extractions: number[];
  elastics: Record<string, unknown>;
  expanders: Record<string, unknown>;
  tads: Record<string, unknown>;
  objectives: string[];
  notes: string;
  templateId: string | null;
  iprPlan: Record<string, number>;
  acceptedAt: string | null;
  signedDocUrl: string | null;
  arches: ArchVM[];
}

export interface PhotoVM {
  id: string;
  kind: PhotoKind;
  url: string;
  thumbUrl: string | null;
  isFavorite: boolean;
  annotations: Annotation[];
  measurements: Measurement[];
  teethRef: number[];
  width: number;
  height: number;
}

export interface PhotoSetVM {
  id: string;
  stageCode: string;
  capturedAt: string;
  notes: string | null;
  photos: PhotoVM[];
}

export type Annotation =
  | { kind: "arrow"; pts: [number, number, number, number]; color?: string; text?: string }
  | { kind: "circle"; cx: number; cy: number; r: number; color?: string }
  | { kind: "text"; x: number; y: number; text: string; color?: string };

export type Measurement =
  | { kind: "ruler"; pts: [number, number, number, number]; mm?: number }
  | { kind: "angle"; pts: [[number, number], [number, number], [number, number]]; deg?: number };

export interface TreatmentCardVM {
  id: string;
  visitDate: string;
  visitType: VisitType;
  appointmentId: string | null;
  archPlacedId: string | null;
  ligColor: string | null;
  ligKind: string | null;
  activations: string[];
  elasticUse: { type?: string; prescribedHours?: string; reportedCompliance?: number };
  bracketsLost: number[];
  iprDoneDelta: Record<string, number>;
  soap: { s: string; o: string; a: string; p: string };
  homeInstr: string;
  nextSuggestedAt: string | null;
  linkedPhotoSet: string | null;
  signedOffAt: string | null;
  createdBy: string;
}

export interface InstallmentVM {
  id: string;
  number: number;
  amount: string; // Decimal serializado
  dueDate: string;
  paidAt: string | null;
  invoiceId: string | null;
  status: InstStatus;
}

export interface FinancialPlanVM {
  id: string;
  total: string;
  downPayment: string;
  months: number;
  monthly: string;
  startDate: string;
  scenarios: FinancialScenario[];
  activeScenarioId: string | null;
  signAtHomeUrl: string | null;
  signedByPatient: boolean;
  signedAt: string | null;
  installments: InstallmentVM[];
}

export interface FinancialScenario {
  id: string;
  label: string;
  mod: "contado" | "plan" | "credito";
  total: number;
  downPayment: number;
  months: number;
  apr: number;
  active?: boolean;
}

export interface RetentionPlanVM {
  id: string;
  retUpper: RetainerKind;
  retLower: RetainerKind;
  fixedGauge: string | null;
  regimen: string;
  checkpoints: string[];
  checkpointsDone: Record<string, { doneAt: string; score?: number; comment?: string }>;
  beforeAfterPdf: string | null;
  referralCode: string;
  referralReward: { kind: string; label: string };
  referralsCount: number;
}

export interface OrthoDocumentVM {
  id: string;
  kind: DocumentKind;
  title: string;
  url: string;
  signedAt: string | null;
  signedToken: string | null;
  createdAt: string;
  createdBy: string;
}

export interface OrthoLabOrderVM {
  id: string;
  itemCode: string;
  itemLabel: string;
  labPartner: string;
  trackingCode: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  status: OrthoLabOrderStatus;
  notes: string | null;
}

export interface CommunicationLogVM {
  id: string;
  channel: string;
  direction: "OUT" | "IN";
  body: string;
  templateId: string | null;
  sentAt: string;
  externalId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle completo del caso — alimenta el orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export interface OrthoCaseBundle {
  case: OrthoCaseVM;
  diagnosis: OrthoDiagnosisVM | null;
  plan: TreatmentPlanVM | null;
  photoSets: PhotoSetVM[];
  cards: TreatmentCardVM[];
  financialPlan: FinancialPlanVM | null;
  retentionPlan: RetentionPlanVM | null;
  documents: OrthoDocumentVM[];
  labOrders: OrthoLabOrderVM[];
  comms: CommunicationLogVM[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Input types · derivados de zod (mismas reglas pero solo TypeScript)
// ─────────────────────────────────────────────────────────────────────────────

export interface DiagnosisInput {
  angleClass: AngleClass;
  subCaninoR?: AngleClass;
  subCaninoL?: AngleClass;
  subMolarR?: AngleClass;
  subMolarL?: AngleClass;
  overjetMm?: number;
  overbiteMm?: number;
  openBite: OpenBite;
  crossBite: CrossBite;
  crowdingMaxMm?: number;
  crowdingMandMm?: number;
  diastemas: Array<{ teeth: [number, number]; mm: number }>;
  midlineDeviation?: number;
  facialProfile: FacialProfile;
  skeletalPattern: SkeletalPattern;
  skeletalIssues: string[];
  tmjFindings: { noise: boolean; pain: boolean; deflexionMm?: number; openingMm?: number };
  habits: string[];
  narrative: string;
}

export interface PlanInput {
  appliances: string[];
  extractions: number[];
  elastics: Record<string, unknown>;
  expanders: Record<string, unknown>;
  tads: Record<string, unknown>;
  objectives: string[];
  notes: string;
  iprPlan: Record<string, number>;
}

export interface ArchInput {
  phase: PhaseEnum;
  material: ArchMaterial;
  gauge: string;
  durationW: number;
  startDate?: Date;
  endDate?: Date;
  notes?: string;
}

export interface FinancialPlanInput {
  total: number;
  downPayment: number;
  months: number;
  monthly: number;
  startDate: Date;
  scenarios?: FinancialScenario[];
}

export interface TreatmentCardInput {
  appointmentId?: string;
  visitDate: Date;
  visitType: VisitType;
  templateUsed?: string;
  archPlacedId?: string;
  ligColor?: string;
  ligKind?: string;
  activations: string[];
  elasticUse?: { type: string; prescribedHours: string; reportedCompliance: number };
  bracketsLost: number[];
  iprDoneDelta?: Record<string, number>;
  soap: { s: string; o: string; a: string; p: string };
  homeInstr: string;
  nextSuggestedAt?: Date;
  linkedPhotoSet?: string;
}

export interface LabOrderInput {
  itemCode: string;
  itemLabel: string;
  labPartner: string;
  trackingCode?: string;
  status: OrthoLabOrderStatus;
  notes?: string;
}

export interface RetentionInput {
  retUpper: RetainerKind;
  retLower: RetainerKind;
  fixedGauge?: string;
  regimen: string;
  checkpoints: Date[];
  referralCode: string;
  referralReward: { kind: string; label: string };
}

export interface ApplianceTypeInput {
  code: string;
  label: string;
  category: string;
}

export interface ReferralInput {
  to: string;
  reason: string;
  notes?: string;
}

// Role for permission checks.
export type OrthoRole = "doctor" | "assistant" | "reception";
