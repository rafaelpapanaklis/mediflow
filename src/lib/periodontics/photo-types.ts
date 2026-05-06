// Periodontics — taxonomía de fotos clínicas perio sobre ClinicalPhoto.
// Sprint cierre dental, COMMIT 2: 7 tipos perio + mapeo a enum schema.

import type { ClinicalPhotoStage, ClinicalPhotoType } from "@prisma/client";

/**
 * Slugs públicos que el SPEC define para periodoncia. Estables en API,
 * URLs y telemetría. Se mapean al enum schema-level `ClinicalPhotoType`
 * (que cubre los 5 módulos) en `PERIO_PHOTO_TYPE_TO_SCHEMA`.
 */
export const PERIO_PHOTO_KIND = [
  "pre_srp",
  "post_srp",
  "pre_surgery",
  "post_surgery",
  "suture_removal",
  "maintenance_check",
  "gingival_recession_baseline",
] as const;

export type PerioPhotoKind = (typeof PERIO_PHOTO_KIND)[number];

/**
 * Mapeo slug perio → valor `ClinicalPhotoType` del schema compartido.
 *
 * `post_srp` reusa `perio_postsrp` (creado por el schema base) para no
 * duplicar valores. El resto se añadió en
 * `20260505150000_perio_photo_types_extension`.
 */
export const PERIO_PHOTO_TYPE_TO_SCHEMA: Record<PerioPhotoKind, ClinicalPhotoType> = {
  pre_srp: "perio_pre_srp",
  post_srp: "perio_postsrp",
  pre_surgery: "perio_pre_surgery",
  post_surgery: "perio_post_surgery",
  suture_removal: "perio_suture_removal",
  maintenance_check: "perio_maintenance_check",
  gingival_recession_baseline: "perio_recession_baseline",
};

const SCHEMA_TO_PERIO: Partial<Record<ClinicalPhotoType, PerioPhotoKind>> = (
  Object.entries(PERIO_PHOTO_TYPE_TO_SCHEMA) as Array<
    [PerioPhotoKind, ClinicalPhotoType]
  >
).reduce<Partial<Record<ClinicalPhotoType, PerioPhotoKind>>>((acc, [k, v]) => {
  acc[v] = k;
  return acc;
}, {});

/**
 * Inverso. Devuelve `null` si el `ClinicalPhotoType` no es perio o no está
 * mapeado (eg. valores legacy `perio_initial`/`perio_surgery` antes de la
 * extensión).
 */
export function schemaPhotoTypeToPerioKind(
  t: ClinicalPhotoType,
): PerioPhotoKind | null {
  return SCHEMA_TO_PERIO[t] ?? null;
}

/**
 * Etiqueta corta UI. Español neutro mexicano. Sin emojis.
 */
export const PERIO_PHOTO_LABEL: Record<PerioPhotoKind, string> = {
  pre_srp: "Pre raspado",
  post_srp: "Post raspado",
  pre_surgery: "Pre cirugía",
  post_surgery: "Post cirugía",
  suture_removal: "Retiro de suturas",
  maintenance_check: "Mantenimiento",
  gingival_recession_baseline: "Recesión gingival (baseline)",
};

/**
 * Stage clínico sugerido según el tipo. La UI puede sobrescribir si el
 * usuario lo marca como `control` (eg. una recesión re-evaluada al año).
 */
export const PERIO_PHOTO_DEFAULT_STAGE: Record<PerioPhotoKind, ClinicalPhotoStage> = {
  pre_srp: "pre",
  post_srp: "post",
  pre_surgery: "pre",
  post_surgery: "post",
  suture_removal: "control",
  maintenance_check: "control",
  gingival_recession_baseline: "pre",
};

/**
 * Pares pre/post para vistas comparativas (COMMIT 13).
 *
 * Devuelve los slugs cuya semántica es comparar evolución temporal. Cada
 * tupla es `[antesKind, despuesKind, etiquetaPar]`.
 */
export const PERIO_PHOTO_COMPARE_PAIRS: ReadonlyArray<
  readonly [PerioPhotoKind, PerioPhotoKind, string]
> = [
  ["pre_srp", "post_srp", "Antes vs. después de raspado"],
  ["pre_surgery", "post_surgery", "Antes vs. después de cirugía"],
  ["pre_surgery", "suture_removal", "Antes de cirugía vs. retiro de suturas"],
  ["post_surgery", "suture_removal", "Post cirugía vs. cicatrización"],
];
