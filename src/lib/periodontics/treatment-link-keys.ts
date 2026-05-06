// Periodontics — claves estables para TreatmentLink.moduleEntityType. SPEC §5, COMMIT 6.
//
// Vive en `lib/` (puro, client-safe) para que componentes de UI puedan
// referenciarlas sin arrastrar `_helpers` al bundle.

export const PERIO_TREATMENT_LINK_ENTITY = {
  SRP: "perio-srp",
  REEVALUATION: "perio-reevaluation",
  SURGERY: "perio-surgery",
} as const;

export type PerioTreatmentLinkEntity =
  (typeof PERIO_TREATMENT_LINK_ENTITY)[keyof typeof PERIO_TREATMENT_LINK_ENTITY];

export const PERIO_TREATMENT_LINK_LABEL: Record<PerioTreatmentLinkEntity, string> = {
  "perio-srp": "Sesión de raspado",
  "perio-reevaluation": "Reevaluación",
  "perio-surgery": "Cirugía periodontal",
};
