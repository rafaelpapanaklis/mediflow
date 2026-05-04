// Periodontics — tipos compartidos derivados de Prisma + tipos UI. SPEC §4, §6

import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────
// Prisma rows
// ─────────────────────────────────────────────────────────────────────

export type PeriodontalRecordRow = Prisma.PeriodontalRecordGetPayload<{}>;
export type PeriodontalClassificationRow = Prisma.PeriodontalClassificationGetPayload<{}>;
export type GingivalRecessionRow = Prisma.GingivalRecessionGetPayload<{}>;
export type PeriodontalTreatmentPlanRow = Prisma.PeriodontalTreatmentPlanGetPayload<{}>;
export type SRPSessionRow = Prisma.SRPSessionGetPayload<{}>;
export type PeriodontalReevaluationRow = Prisma.PeriodontalReevaluationGetPayload<{}>;
export type PeriodontalRiskAssessmentRow = Prisma.PeriodontalRiskAssessmentGetPayload<{}>;
export type PeriodontalSurgeryRow = Prisma.PeriodontalSurgeryGetPayload<{}>;
export type PeriImplantAssessmentRow = Prisma.PeriImplantAssessmentGetPayload<{}>;

export type PeriodontalRecordWithClassification =
  Prisma.PeriodontalRecordGetPayload<{ include: { classification: true } }>;

export type PeriodontalPlanFull = Prisma.PeriodontalTreatmentPlanGetPayload<{
  include: {
    srpSessions: { orderBy: { performedAt: "desc" } };
    reevaluations: { orderBy: { evaluatedAt: "desc" } };
    surgeries: { orderBy: { surgeryDate: "desc" } };
  };
}>;

// ─────────────────────────────────────────────────────────────────────
// UI types — formas que el grid 6×32 manipula en cliente
// ─────────────────────────────────────────────────────────────────────

/**
 * Una fila del JSON `sites`. 192 entradas por record (6 sitios × 32 dientes).
 * El SPEC fija el shape; Prisma lo guarda como JSON para evitar tabla pesada.
 */
export interface PerioSite {
  fdi: number;
  position: "MV" | "MB" | "DV" | "DL" | "ML" | "MB_PAL";
  pdMm: number; // 0..15 — profundidad de bolsa
  recMm: number; // 0..15 — recesión
  bop: boolean; // sangrado al sondaje
  plaque: boolean;
  suppuration: boolean;
}

/**
 * Una fila del JSON `toothLevel`. 32 entradas por record (1 por diente).
 */
export interface PerioToothLevel {
  fdi: number;
  mobility: 0 | 1 | 2 | 3;
  furcation: 0 | 1 | 2 | 3; // grado Hamp 0=ninguna, 1=I, 2=II, 3=III
  absent: boolean;
  isImplant: boolean;
}

/**
 * Categoría visual del diente para elegir SVG en `<ToothCenter />`.
 */
export type ToothCategory =
  | "incisor_upper"
  | "incisor_lower"
  | "canine"
  | "premolar"
  | "molar";

/**
 * Modificadores que ajustan el grado de la clasificación 2017.
 * Spec §4.2 (`PeriodontalClassification.modifiers`).
 */
export interface PerioClassificationModifiers {
  smokingCigsPerDay?: number;
  hba1c?: number;
  otherFactors?: string[];
}

/**
 * Inputs auditables del cálculo automático. Spec §4.2 (`computationInputs`).
 */
export interface PerioClassificationComputationInputs {
  maxCalInterproximalMm: number;
  maxBoneLossPct?: number;
  maxPdMm: number;
  lostTeethPerio: number;
  complexityFactors: string[];
  boneLossAgeRatio?: number;
}

/**
 * Live indicators visibles en el header del periodontograma. Spec §6.6.
 */
export interface PerioLiveIndicators {
  bopPercentage: number; // 0..100
  plaqueIndexOleary: number; // 0..100
  sites1to3mm: number;
  sites4to5mm: number;
  sites6PlusMm: number;
  teethWithPockets5Plus: number;
}

/**
 * Resumen Berna que el ResumenTab + RiskBadge consumen.
 */
export interface PerioRiskSummary {
  category: "BAJO" | "MODERADO" | "ALTO";
  recommendedRecallMonths: 3 | 4 | 6;
  factors: string[];
}
