// Pediatrics — tipos compartidos derivados de Prisma. Spec: §4.A.2

import type { Prisma } from "@prisma/client";

export type PediatricRecordFull = Prisma.PediatricRecordGetPayload<{
  include: {
    primaryGuardian: true;
    guardians: true;
    behaviorAssessments: { orderBy: { recordedAt: "desc" } };
    cariesAssessments: { orderBy: { scoredAt: "desc" }; take: 1 };
    oralHabits: true;
    eruptionRecords: true;
    sealants: true;
    spaceMaintainers: true;
    fluorideApplications: { orderBy: { appliedAt: "desc" } };
    endoTreatments: { orderBy: { performedAt: "desc" } };
    consents: true;
  };
}>;

export type GuardianRow = Prisma.GuardianGetPayload<{}>;

export type BehaviorAssessmentRow = Prisma.BehaviorAssessmentGetPayload<{}>;

export type CariesRiskAssessmentRow = Prisma.CariesRiskAssessmentGetPayload<{}>;

export type OralHabitRow = Prisma.OralHabitGetPayload<{}>;

export type EruptionRecordRow = Prisma.EruptionRecordGetPayload<{}>;

export type SealantRow = Prisma.SealantGetPayload<{}>;

export type SpaceMaintainerRow = Prisma.SpaceMaintainerGetPayload<{}>;

export type FluorideApplicationRow = Prisma.FluorideApplicationGetPayload<{}>;

export type EndoTreatmentRow = Prisma.PediatricEndodonticTreatmentGetPayload<{}>;

export type PediatricConsentRow = Prisma.PediatricConsentGetPayload<{
  include: { guardian: true };
}>;

/** Datos pre-computados que el shell pasa al ContextStrip + Siderail. */
export interface PediatricsHeaderData {
  ageBreakdown: { years: number; months: number; decimal: number; formatted: string; long: string };
  dentitionType: "temporal" | "mixta" | "permanente";
  cambraCategory: "bajo" | "moderado" | "alto" | "extremo" | null;
  latestFranklValues: Array<{ value: number; date: Date }>;
  pendingConsentsCount: number;
}

export interface ToothSurfaceState {
  surface: "O" | "V" | "L" | "M" | "D";
  state: "sano" | "caries" | "mancha_blanca" | "sellante" | "restauracion" | "endodoncia" | "ausente";
}

export type ToothState =
  | "erupted"
  | "unerupted"
  | "missing-physio"
  | "missing-patho";
