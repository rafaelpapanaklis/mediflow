// Orthodontics — los 5 sub-tipos orto sobre la infra LabOrder cross-cutting.
//
// El enum SQL `LabOrderType` solo expone tipos genéricos: ortho_appliance,
// retainer, other. Para distinguir sub-tipos clínicos relevantes en orto
// usamos el campo `spec.ortho_subtype` con uno de los valores de
// `OrthoLabSubtype`. El PDF imprime las claves de spec textualmente.

import type { LabOrderType } from "@prisma/client";

export type OrthoLabSubtype =
  | "alineadores_serie"
  | "retenedor_essix"
  | "retenedor_hawley"
  | "modelos_estudio_digital"
  | "expansor_personalizado";

export const ORTHO_LAB_SUBTYPES: readonly OrthoLabSubtype[] = [
  "alineadores_serie",
  "retenedor_essix",
  "retenedor_hawley",
  "modelos_estudio_digital",
  "expansor_personalizado",
];

export const ORTHO_LAB_SUBTYPE_LABELS: Record<OrthoLabSubtype, string> = {
  alineadores_serie: "Alineadores (serie completa)",
  retenedor_essix: "Retenedor Essix",
  retenedor_hawley: "Retenedor Hawley",
  modelos_estudio_digital: "Modelos de estudio digitales",
  expansor_personalizado: "Expansor personalizado",
};

/** Mapea cada sub-tipo orto al `LabOrderType` Prisma correspondiente. */
export const ORTHO_LAB_TYPE_MAP: Record<OrthoLabSubtype, LabOrderType> = {
  alineadores_serie: "ortho_appliance",
  retenedor_essix: "retainer",
  retenedor_hawley: "retainer",
  modelos_estudio_digital: "other",
  expansor_personalizado: "ortho_appliance",
};

/**
 * Campos requeridos del `spec` JSON por sub-tipo. La UI valida que el
 * usuario llene al menos estos campos antes de habilitar "Crear orden".
 */
export const ORTHO_LAB_REQUIRED_SPEC_FIELDS: Record<OrthoLabSubtype, string[]> = {
  alineadores_serie: ["technique", "stages_count", "stripping_required"],
  retenedor_essix: ["arch", "thickness_mm"],
  retenedor_hawley: ["arch", "wire_gauge", "color_acrylic"],
  modelos_estudio_digital: ["scan_format", "include_oclusal"],
  expansor_personalizado: [
    "expander_type",
    "anchor_teeth_fdis",
    "expansion_target_mm",
  ],
};

/** Plantilla de campos sugeridos por sub-tipo (el usuario edita libre). */
export const ORTHO_LAB_DEFAULT_SPEC: Record<OrthoLabSubtype, Record<string, string>> = {
  alineadores_serie: {
    ortho_subtype: "alineadores_serie",
    technique: "Invisalign Comprehensive",
    stages_count: "30",
    stripping_required: "no",
    refinement_included: "yes",
    notes_clinico: "",
  },
  retenedor_essix: {
    ortho_subtype: "retenedor_essix",
    arch: "ambas",
    thickness_mm: "1.0",
    extension: "hasta_segundo_molar",
    notes_clinico: "",
  },
  retenedor_hawley: {
    ortho_subtype: "retenedor_hawley",
    arch: "ambas",
    wire_gauge: "0.7",
    color_acrylic: "transparente",
    has_anterior_loop: "yes",
    notes_clinico: "",
  },
  modelos_estudio_digital: {
    ortho_subtype: "modelos_estudio_digital",
    scan_format: "STL",
    include_oclusal: "yes",
    include_perfil: "no",
    notes_clinico: "",
  },
  expansor_personalizado: {
    ortho_subtype: "expansor_personalizado",
    expander_type: "Hyrax",
    anchor_teeth_fdis: "16, 26",
    expansion_target_mm: "8",
    notes_clinico: "",
  },
};
