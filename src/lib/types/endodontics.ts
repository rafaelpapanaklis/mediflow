// Endodontics — tipos compartidos derivados de Prisma + tipos UI. Spec §6.1, §7.6

import type { Prisma } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────
// Prisma "rows" (lo que devuelven findMany sin includes)
// ─────────────────────────────────────────────────────────────────────

export type EndodonticDiagnosisRow = Prisma.EndodonticDiagnosisGetPayload<{}>;
export type VitalityTestRow = Prisma.VitalityTestGetPayload<{}>;
export type EndodonticTreatmentRow = Prisma.EndodonticTreatmentGetPayload<{}>;
export type RootCanalRow = Prisma.RootCanalGetPayload<{}>;
export type IntracanalMedicationRow = Prisma.IntracanalMedicationGetPayload<{}>;
export type EndodonticFollowUpRow = Prisma.EndodonticFollowUpGetPayload<{}>;
export type EndodonticRetreatmentInfoRow = Prisma.EndodonticRetreatmentInfoGetPayload<{}>;
export type ApicalSurgeryRow = Prisma.ApicalSurgeryGetPayload<{}>;

// ─────────────────────────────────────────────────────────────────────
// Treatment "full" — usado por ToothCenterView, PDFs, mock seed.
// ─────────────────────────────────────────────────────────────────────

export type EndodonticTreatmentFull = Prisma.EndodonticTreatmentGetPayload<{
  include: {
    diagnosis: true;
    rootCanals: { include: { conductometryFile: true } };
    intracanalMedications: { orderBy: { placedAt: "desc" } };
    followUps: { include: { controlFile: true }; orderBy: { scheduledAt: "asc" } };
    retreatmentInfo: true;
    apicalSurgery: { include: { intraoperativeFile: true } };
  };
}>;

// ─────────────────────────────────────────────────────────────────────
// Tipos UI (específicos del módulo, no derivados de Prisma)
// ─────────────────────────────────────────────────────────────────────

export type ToothCategory =
  | "incisor"
  | "canine"
  | "premolar_upper"
  | "premolar_lower"
  | "molar_upper"
  | "molar_lower"
  | "molar_lower_cshape";

/** SVG arquetipo: cuál de los 8 archivos en public/specialties/endodontics/anatomy/ se carga. */
export type CanalSvgArchetype =
  | "incisor"
  | "canine"
  | "premolar-upper-1canal"
  | "premolar-upper-2canal"
  | "premolar-lower"
  | "molar-upper-mb2"
  | "molar-lower"
  | "molar-lower-cshape";

/**
 * Estado de cada conducto en el `<CanalMap />`. El motor mapea
 * `canonicalName` a un id `<g id="canal-{lowercase}">` del SVG y aplica
 * el color desde QUALITY_COLORS según `obturationQuality`.
 */
export interface CanalRenderState {
  canonicalName: string;
  customLabel?: string | null;
  obturationQuality?: string | null;
  workingLengthMm?: number | null;
  masterApicalFileIso?: number | null;
  masterApicalFileTaper?: number | null;
}

/** Datos pre-computados que el page hidrata para el shell del módulo. */
export interface ToothCenterViewData {
  patientId: string;
  patientName: string;
  toothFdi: number;
  category: ToothCategory;
  archetype: CanalSvgArchetype;
  diagnosis: EndodonticDiagnosisRow | null;
  recentVitality: VitalityTestRow[];
  activeTreatment: EndodonticTreatmentFull | null;
  pastTreatments: EndodonticTreatmentFull[];
}

/** Datos para el panel izquierdo (ToothMiniOdontogram). */
export interface EndoToothSummary {
  fdi: number;
  hasActiveTreatment: boolean;
  outcomeStatus: string | null;
  hasPendingFollowUp: boolean;
  hasPendingRestoration: boolean;
  treatmentsCount: number;
}

/** SOAP pre-fill output (compatible con el editor SOAP existente). */
export interface SoapPrefill {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}
