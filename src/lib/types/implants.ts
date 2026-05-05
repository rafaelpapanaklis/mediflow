// Implants — types compartidos derivados de Prisma. Spec §4.2.

import type {
  Implant,
  ImplantSurgicalRecord,
  ImplantHealingPhase,
  ImplantSecondStageSurgery,
  ImplantProstheticPhase,
  ImplantComplication,
  ImplantFollowUp,
  ImplantConsent,
  ImplantPassport,
  ImplantBrand,
  ImplantStatus,
  ImplantProtocol,
  ImplantConnectionType,
  ImplantSurfaceTreatment,
  LekholmZarbDensity,
  AbutmentType,
  ProsthesisType,
  ProsthesisMaterial,
  ImplantComplicationType,
  ASAClassification,
  ImplantFollowUpMilestone,
  ImplantConsentType,
} from "@prisma/client";

// NOTE: BoneGraftSource existe en el schema pero Prisma solo genera el
// runtime enum cuando algún modelo lo referencia. Como BoneAugmentation
// es v1.1 (comentado en schema), el enum no aparece en @prisma/client
// hasta que se active. Se re-importará aquí cuando se libere v1.1.

export type {
  Implant,
  ImplantSurgicalRecord,
  ImplantHealingPhase,
  ImplantSecondStageSurgery,
  ImplantProstheticPhase,
  ImplantComplication,
  ImplantFollowUp,
  ImplantConsent,
  ImplantPassport,
  ImplantBrand,
  ImplantStatus,
  ImplantProtocol,
  ImplantConnectionType,
  ImplantSurfaceTreatment,
  LekholmZarbDensity,
  AbutmentType,
  ProsthesisType,
  ProsthesisMaterial,
  ImplantComplicationType,
  ASAClassification,
  ImplantFollowUpMilestone,
  ImplantConsentType,
};

/** Implante + todas las sub-fases cargadas. Usado en ImplantCard. */
export type ImplantFull = Implant & {
  surgicalRecord: ImplantSurgicalRecord | null;
  healingPhase: ImplantHealingPhase | null;
  secondStage: ImplantSecondStageSurgery | null;
  prostheticPhase: ImplantProstheticPhase | null;
  complications: ImplantComplication[];
  followUps: ImplantFollowUp[];
  consents: ImplantConsent[];
  passport: ImplantPassport | null;
};

/** Resultado de las server actions (patrón Result<T> del repo). */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: unknown };

/** Resultado fallido — útil para narrowing en el cliente. */
export type Failure = { ok: false; error: string; issues?: unknown };

export function isFailure<T>(r: Result<T>): r is Failure {
  return !r.ok;
}

/** Severidad textual estandarizada en complicaciones y follow-ups. */
export type SeverityLevel = "leve" | "moderada" | "severa";

/** Outcome de una complicación resuelta. */
export type ComplicationOutcome =
  | "exitoso"
  | "parcial"
  | "fracaso"
  | "en_curso";

/** Categorías de complicación agrupadas para el ComplicationDrawer. */
export const COMPLICATION_GROUPS: Record<
  "biologicas" | "mecanicas" | "quirurgicas" | "otras",
  ReadonlyArray<ImplantComplicationType>
> = {
  biologicas: [
    "PERI_IMPLANT_MUCOSITIS",
    "PERI_IMPLANTITIS_INITIAL",
    "PERI_IMPLANTITIS_MODERATE",
    "PERI_IMPLANTITIS_ADVANCED",
  ],
  mecanicas: [
    "SCREW_LOOSENING",
    "ABUTMENT_SCREW_FRACTURE",
    "PROSTHESIS_FRACTURE",
    "IMPLANT_FRACTURE",
  ],
  quirurgicas: [
    "NERVE_DAMAGE_TRANSIENT",
    "NERVE_DAMAGE_PERMANENT",
    "SINUS_PERFORATION",
    "SINUS_INFECTION",
  ],
  otras: ["OSSEOINTEGRATION_FAILURE", "AESTHETIC_COMPLICATION", "OTRO"],
};

/** True si el tipo de complicación es biológica (mucositis / peri-implantitis). */
export function isBiologicalComplication(
  type: ImplantComplicationType,
): boolean {
  return COMPLICATION_GROUPS.biologicas.includes(type);
}
