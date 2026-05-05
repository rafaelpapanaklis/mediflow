// Orthodontics — validación + ordenamiento + pareo cross-set de las 8 vistas. SPEC §6.7.

import type { OrthoPhotoSetType } from "@prisma/client";
import type { OrthoPhotoSetWithFiles, PhotoComparePair } from "@/lib/types/orthodontics";

/**
 * `OrthoPhotoView` se define como TS literal type, NO como enum Prisma:
 * el enum SQL existe (la migración F1 lo creó) pero no hay columna que lo
 * use, así que Prisma no lo genera en su client. Ningún modelo del MVP
 * tiene una columna `view` — el set guarda 8 columnas tipadas y la vista
 * se infiere de qué columna está poblada. v1.1 puede usar el enum SQL
 * para una tabla de fotos por-vista si se decide refactorizar.
 */
export type OrthoPhotoView =
  | "EXTRA_FRONTAL"
  | "EXTRA_PROFILE"
  | "EXTRA_SMILE"
  | "INTRA_FRONTAL_OCCLUSION"
  | "INTRA_LATERAL_RIGHT"
  | "INTRA_LATERAL_LEFT"
  | "INTRA_OCCLUSAL_UPPER"
  | "INTRA_OCCLUSAL_LOWER";

/** Orden canónico de las 8 vistas — mismo que el wizard. */
export const PHOTO_VIEW_ORDER: readonly OrthoPhotoView[] = [
  "EXTRA_FRONTAL",
  "EXTRA_PROFILE",
  "EXTRA_SMILE",
  "INTRA_FRONTAL_OCCLUSION",
  "INTRA_LATERAL_RIGHT",
  "INTRA_LATERAL_LEFT",
  "INTRA_OCCLUSAL_UPPER",
  "INTRA_OCCLUSAL_LOWER",
] as const;

/** Mapeo `OrthoPhotoView` → columna del modelo `OrthoPhotoSet`. */
export const VIEW_TO_COLUMN: Record<OrthoPhotoView, keyof OrthoPhotoSetWithFiles> = {
  EXTRA_FRONTAL: "photoFrontal",
  EXTRA_PROFILE: "photoProfile",
  EXTRA_SMILE: "photoSmile",
  INTRA_FRONTAL_OCCLUSION: "photoIntraFrontal",
  INTRA_LATERAL_RIGHT: "photoIntraLateralR",
  INTRA_LATERAL_LEFT: "photoIntraLateralL",
  INTRA_OCCLUSAL_UPPER: "photoOcclusalUpper",
  INTRA_OCCLUSAL_LOWER: "photoOcclusalLower",
};

/** Mapeo `OrthoPhotoView` → columna `*Id` (FK plana). */
export const VIEW_TO_ID_COLUMN: Record<OrthoPhotoView, keyof PhotoSetIdColumns> = {
  EXTRA_FRONTAL: "photoFrontalId",
  EXTRA_PROFILE: "photoProfileId",
  EXTRA_SMILE: "photoSmileId",
  INTRA_FRONTAL_OCCLUSION: "photoIntraFrontalId",
  INTRA_LATERAL_RIGHT: "photoIntraLateralRId",
  INTRA_LATERAL_LEFT: "photoIntraLateralLId",
  INTRA_OCCLUSAL_UPPER: "photoOcclusalUpperId",
  INTRA_OCCLUSAL_LOWER: "photoOcclusalLowerId",
};

export interface PhotoSetIdColumns {
  photoFrontalId: string | null;
  photoProfileId: string | null;
  photoSmileId: string | null;
  photoIntraFrontalId: string | null;
  photoIntraLateralRId: string | null;
  photoIntraLateralLId: string | null;
  photoOcclusalUpperId: string | null;
  photoOcclusalLowerId: string | null;
}

/** Verifica si el set tiene las 8 vistas obligatorias. */
export function isCompleteSet(set: PhotoSetIdColumns): boolean {
  return PHOTO_VIEW_ORDER.every((view) => Boolean(set[VIEW_TO_ID_COLUMN[view]]));
}

/** Lista las vistas faltantes para guiar el wizard. */
export function missingViews(set: PhotoSetIdColumns): OrthoPhotoView[] {
  return PHOTO_VIEW_ORDER.filter((view) => !set[VIEW_TO_ID_COLUMN[view]]);
}

/**
 * Selecciona los `OrthoPhotoSetType` permitidos al iniciar un set nuevo.
 * Reglas SPEC §6.7:
 *   - T0 disponible solo si no existe T0 previo.
 *   - T1 disponible solo si T0 existe, no hay T1 previo y T2 aún no se hizo
 *     (T2 marca cierre, ya no tiene sentido un T1 retrospectivo).
 *   - T2 disponible solo si T0 existe y no hay T2 previo (cierre único).
 *   - CONTROL siempre disponible.
 */
export function availableSetTypes(
  existingTypes: ReadonlySet<OrthoPhotoSetType>,
): OrthoPhotoSetType[] {
  const out: OrthoPhotoSetType[] = [];
  if (!existingTypes.has("T0")) out.push("T0");
  if (
    existingTypes.has("T0") &&
    !existingTypes.has("T1") &&
    !existingTypes.has("T2")
  ) {
    out.push("T1");
  }
  if (existingTypes.has("T0") && !existingTypes.has("T2")) out.push("T2");
  out.push("CONTROL");
  return out;
}

/**
 * Crea pares de fotos para `PhotoCompareSlider` cruzando dos sets por
 * `OrthoPhotoView`. Si una de las dos vistas falta, devuelve null en su
 * lado para que el slider muestre placeholder. SPEC §6.7.
 */
export function buildComparePairs(args: {
  before: { set: OrthoPhotoSetWithFiles; resolveUrl: (fileId: string) => string };
  after: { set: OrthoPhotoSetWithFiles; resolveUrl: (fileId: string) => string };
}): PhotoComparePair[] {
  return PHOTO_VIEW_ORDER.map((view) => {
    const beforeFileId = args.before.set[VIEW_TO_ID_COLUMN[view]] ?? null;
    const afterFileId = args.after.set[VIEW_TO_ID_COLUMN[view]] ?? null;
    return {
      view,
      beforeFileId,
      beforeUrl: beforeFileId ? args.before.resolveUrl(beforeFileId) : null,
      afterFileId,
      afterUrl: afterFileId ? args.after.resolveUrl(afterFileId) : null,
    };
  });
}

/** Etiqueta humana de cada vista para tooltips/diagramas. */
export const VIEW_LABELS: Record<OrthoPhotoView, string> = {
  EXTRA_FRONTAL: "Extraoral frontal",
  EXTRA_PROFILE: "Extraoral perfil",
  EXTRA_SMILE: "Extraoral sonrisa",
  INTRA_FRONTAL_OCCLUSION: "Intraoral frontal en oclusión",
  INTRA_LATERAL_RIGHT: "Intraoral lateral derecho",
  INTRA_LATERAL_LEFT: "Intraoral lateral izquierdo",
  INTRA_OCCLUSAL_UPPER: "Oclusal superior",
  INTRA_OCCLUSAL_LOWER: "Oclusal inferior",
};
