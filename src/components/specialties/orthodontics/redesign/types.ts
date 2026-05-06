// Orthodontics rediseño Fase 1 — data model TypeScript del SPEC.
// Vive aislado del schema Prisma para que la UI sea testeable sin BD.
// Los adapters convierten Prisma rows → estos tipos.

import type {
  OrthoApplianceSlot,
  OrthoBondingType,
  OrthoSkeletalPattern,
  OrthoWireMaterial,
  OrthoWireShape,
  OrthoWireStepStatus,
  OrthoElasticClass,
  OrthoElasticZone,
  OrthoTadBrand,
  OrthoExpanderType,
  OrthoDistalizerType,
  OrthoGingivitisLevel,
  OrthoCardStatus,
  OrthoPhaseKey,
  OrthoTreatmentStatus,
  PatientFlowStatus,
} from "@prisma/client";

export type {
  OrthoApplianceSlot,
  OrthoBondingType,
  OrthoSkeletalPattern,
  OrthoWireMaterial,
  OrthoWireShape,
  OrthoWireStepStatus,
  OrthoElasticClass,
  OrthoElasticZone,
  OrthoTadBrand,
  OrthoExpanderType,
  OrthoDistalizerType,
  OrthoGingivitisLevel,
  OrthoCardStatus,
  OrthoPhaseKey,
  OrthoTreatmentStatus,
  PatientFlowStatus,
};

// ─── Etiquetas legibles (ES neutro mexicano) ───────────────────────────

export const PHASE_LABELS: Record<OrthoPhaseKey, string> = {
  ALIGNMENT: "Alineación",
  LEVELING: "Nivelación",
  SPACE_CLOSURE: "Cierre de espacios",
  DETAILS: "Detalles",
  FINISHING: "Finalización",
  RETENTION: "Retención",
};

export const PHASE_ORDER: readonly OrthoPhaseKey[] = [
  "ALIGNMENT",
  "LEVELING",
  "SPACE_CLOSURE",
  "DETAILS",
  "FINISHING",
  "RETENTION",
] as const;

export const APPLIANCE_SLOT_LABELS: Record<OrthoApplianceSlot, string> = {
  MBT_018: "MBT 0.018",
  MBT_022: "MBT 0.022",
  ROTH_018: "Roth 0.018",
  ROTH_022: "Roth 0.022",
  DAMON_Q2: "Damon Q2",
  DAMON_ULTIMA: "Damon Ultima",
  SPARK: "Spark",
  INVISALIGN: "Invisalign",
};

export const BONDING_LABELS: Record<OrthoBondingType, string> = {
  DIRECTO: "directo",
  INDIRECTO: "indirecto",
};

export const SKELETAL_PATTERN_LABELS: Record<OrthoSkeletalPattern, string> = {
  MESOFACIAL: "mesofacial",
  DOLICOFACIAL: "dolicofacial",
  BRAQUIFACIAL: "braquifacial",
};

export const WIRE_MATERIAL_LABELS: Record<OrthoWireMaterial, string> = {
  NITI: "NiTi",
  SS: "SS",
  TMA: "TMA",
  BETA_TITANIUM: "Beta-Titanium",
};

export const WIRE_SHAPE_LABELS: Record<OrthoWireShape, string> = {
  ROUND: "round",
  RECT: "rect",
};

export const WIRE_STATUS_LABELS: Record<OrthoWireStepStatus, string> = {
  PLANNED: "futuro",
  ACTIVE: "actual",
  COMPLETED: "pasado",
  SKIPPED: "saltado",
};

export const ELASTIC_CLASS_LABELS: Record<OrthoElasticClass, string> = {
  CLASE_I: "Clase I",
  CLASE_II: "Clase II",
  CLASE_III: "Clase III",
  BOX: "Box",
  CRISS_CROSS: "Criss-Cross",
  SETTLING: "Settling",
};

export const ELASTIC_ZONE_LABELS: Record<OrthoElasticZone, string> = {
  ANTERIOR: "anterior",
  POSTERIOR: "posterior",
  INTERMAXILAR: "intermaxilar",
};

export const TAD_BRAND_LABELS: Record<OrthoTadBrand, string> = {
  DENTOS: "Dentos",
  SPIDER: "Spider",
  IMTEC: "IMTEC",
  OTHER: "Otra marca",
};

export const EXPANDER_LABELS: Record<OrthoExpanderType, string> = {
  RPE_HYRAX: "RPE / Hyrax",
  QUAD_HELIX: "Quad-Helix",
  MCNAMARA: "McNamara",
  OTHER: "Otro",
};

export const DISTALIZER_LABELS: Record<OrthoDistalizerType, string> = {
  PENDULUM: "Pendulum",
  CARRIERE: "Carriere",
  BENESLIDER: "Beneslider",
  FORSUS: "Forsus",
  OTHER: "Otro",
};

export const GINGIVITIS_LABELS: Record<OrthoGingivitisLevel, string> = {
  AUSENTE: "ausente",
  LEVE: "leve",
  MODERADA: "moderada",
  SEVERA: "severa",
};

export const FLOW_STATUS_LABELS: Record<PatientFlowStatus, string> = {
  WAITING: "espera",
  IN_CHAIR: "sillón",
  CHECKOUT: "salida",
  COMPLETED: "completado",
};

// ─── DTOs (vista) ──────────────────────────────────────────────────────

export interface OrthoTreatmentDTO {
  patientId: string;
  treatmentPlanId: string | null;
  status: "no-iniciado" | "en-tratamiento" | "retencion" | "completado";
  phase: OrthoPhaseKey | null;
  monthCurrent: number;
  monthTotal: number;
  appliance: {
    type: string | null;
    prescriptionSlot: OrthoApplianceSlot | null;
    bonding: OrthoBondingType | null;
    notes: string | null;
  };
  wireCurrent: WireStepDTO | null;
  startDate: string | null;
  estimatedEndDate: string | null;
  attendancePct: number;
  elasticsCompliancePct: number;
  totalCost: number;
  paid: number;
}

export interface DiagnosisDTO {
  id: string;
  angleClassRight: string;
  angleClassLeft: string;
  overbiteMm: number;
  overjetMm: number;
  crowdingUpperMm: number | null;
  crowdingLowerMm: number | null;
  midlineDeviationMm: number | null;
  crossbite: boolean;
  crossbiteDetails: string | null;
  openBite: boolean;
  openBiteDetails: string | null;
  skeletalPattern: OrthoSkeletalPattern | null;
  habits: string[];
  habitsDescription: string | null;
  tmjPainPresent: boolean;
  tmjClickingPresent: boolean;
  tmjNotes: string | null;
  clinicalSummary: string;
}

export interface WireStepDTO {
  id: string;
  orderIndex: number;
  phaseKey: OrthoPhaseKey;
  material: OrthoWireMaterial;
  shape: OrthoWireShape;
  gauge: string;
  purpose: string | null;
  archUpper: boolean;
  archLower: boolean;
  durationWeeks: number;
  auxiliaries: string[];
  notes: string | null;
  status: OrthoWireStepStatus;
  plannedDate: string | null;
  appliedDate: string | null;
  completedDate: string | null;
}

export interface ElasticDTO {
  id: string;
  elasticClass: OrthoElasticClass;
  config: string;
  zone: OrthoElasticZone;
}

export interface IPRPointDTO {
  id: string;
  toothA: number;
  toothB: number;
  amountMm: number;
  done: boolean;
}

export interface BrokenBracketDTO {
  id: string;
  toothFdi: number;
  brokenDate: string;
  reBondedDate: string | null;
  notes: string | null;
}

export interface SOAP {
  s: string;
  o: string;
  a: string;
  p: string;
}

export interface HygieneDTO {
  plaquePct: number | null;
  gingivitis: OrthoGingivitisLevel | null;
  whiteSpots: boolean;
}

export interface TreatmentCardDTO {
  id: string;
  cardNumber: number;
  visitDate: string;
  durationMin: number;
  phaseKey: OrthoPhaseKey;
  monthAt: number;
  wireFrom: WireStepDTO | null;
  wireTo: WireStepDTO | null;
  soap: SOAP;
  hygiene: HygieneDTO;
  hasProgressPhoto: boolean;
  photoSetId: string | null;
  nextDate: string | null;
  nextDurationMin: number | null;
  status: OrthoCardStatus;
  signedAt: string | null;
  signedByName: string | null;
  elastics: ElasticDTO[];
  iprPoints: IPRPointDTO[];
  brokenBrackets: BrokenBracketDTO[];
}

export interface TADDTO {
  id: string;
  brand: OrthoTadBrand;
  size: string;
  location: string;
  torqueNcm: number | null;
  placedDate: string;
  failed: boolean;
  failedDate: string | null;
  failureReason: string | null;
}

export interface AuxMechanicsDTO {
  id: string | null;
  expanderType: OrthoExpanderType | null;
  expanderActivations: number | null;
  expanderInstalledAt: string | null;
  expanderRemovedAt: string | null;
  distalizerType: OrthoDistalizerType | null;
  distalizerInstalledAt: string | null;
  distalizerRemovedAt: string | null;
  notes: string | null;
}

export interface PhaseTransitionDTO {
  id: string;
  fromPhase: OrthoPhaseKey;
  toPhase: OrthoPhaseKey;
  criteriaChecked: string[];
  doctorNotes: string | null;
  signedByName: string;
  signedAt: string;
  isOverride: boolean;
  overrideReason: string | null;
}

export interface PatientFlowDTO {
  id: string;
  status: PatientFlowStatus;
  chair: string | null;
  enteredAt: string;
  exitedAt: string | null;
}

export interface NextAppointmentDTO {
  date: string;
  durationMin: number;
  type: string;
  doctor: string;
  chair: string | null;
  prep: string[];
}

export interface AISuggestionDTO {
  id: string;
  title: string;
  body: string;
  cta: "whatsapp" | "schedule" | "create-task";
  ctaLabel: string;
}

export interface WhatsAppEntryDTO {
  id: string;
  at: string;
  direction: "in" | "out";
  template: string | null;
  preview: string;
}

export interface OrthoRedesignViewModel {
  patient: {
    id: string;
    firstName: string;
    fullName: string;
    avatarInitials: string;
  };
  treatment: OrthoTreatmentDTO;
  diagnosis: DiagnosisDTO | null;
  wireSequence: WireStepDTO[];
  treatmentCards: TreatmentCardDTO[];
  tads: TADDTO[];
  auxMechanics: AuxMechanicsDTO | null;
  phaseTransitions: PhaseTransitionDTO[];
  patientFlow: PatientFlowDTO | null;
  nextAppointment: NextAppointmentDTO | null;
  aiSuggestions: AISuggestionDTO[];
  whatsappRecent: WhatsAppEntryDTO[];
}
