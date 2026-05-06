/**
 * Helpers puros para galería clínica universal (ClinicalPhoto).
 * Server actions viven en `photo-gallery.actions.ts`.
 */
import { z } from "zod";
import {
  type ClinicalModule,
  type ClinicalPhotoStage,
  type ClinicalPhotoType,
  type ImplantPhaseKey,
  IMPLANT_PHOTO_TYPES,
  implantPhotoTypeToPhase,
  isImplantPhotoType,
} from "./types";

// ── Schemas de validación ────────────────────────────────────────────

export const clinicalPhotoCreateSchema = z.object({
  patientId: z.string().min(1),
  module: z.enum([
    "pediatrics",
    "endodontics",
    "periodontics",
    "implants",
    "orthodontics",
  ]),
  toothFdi: z.number().int().min(11).max(85).nullable().optional(),
  photoType: z.string().min(1), // validado contra Prisma enum en server action
  stage: z.enum(["pre", "during", "post", "control"]),
  capturedAt: z.coerce.date().optional(),
  blobUrl: z.string().url(),
  thumbnailUrl: z.string().url().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  annotations: z.record(z.unknown()).nullable().optional(),
});

export type ClinicalPhotoCreateInput = z.infer<typeof clinicalPhotoCreateSchema>;

// ── Etiquetas en español neutro ──────────────────────────────────────

export function clinicalPhotoStageLabel(stage: ClinicalPhotoStage): string {
  switch (stage) {
    case "pre":
      return "Antes";
    case "during":
      return "Durante";
    case "post":
      return "Después";
    case "control":
      return "Control";
    default:
      return stage;
  }
}

export function clinicalPhotoTypeLabel(type: ClinicalPhotoType): string {
  switch (type) {
    // implantes
    case "implant_site_pre":
      return "Sitio implante (pre)";
    case "implant_placement":
      return "Colocación de implante";
    case "implant_healing":
      return "Cicatrización";
    case "implant_prosthetic":
      return "Fase protésica";
    case "pre_surgical":
      return "Pre-quirúrgico";
    case "surgical_phase":
      return "Cirugía";
    case "second_stage":
      return "Segunda fase";
    case "prosthetic_placement":
      return "Colocación de prótesis";
    case "follow_up_radiograph":
      return "Radiografía de control";
    case "peri_implant_check":
      return "Control peri-implantar";
    // genéricos
    case "pre_treatment":
      return "Pre-tratamiento";
    case "post_treatment":
      return "Post-tratamiento";
    case "oral_general":
      return "Oral general";
    case "other":
      return "Otra";
    default:
      return type;
  }
}

/**
 * Tipos de foto considerados radiográficos (renderizado en escala de grises).
 */
export function isRadiographPhotoType(type: ClinicalPhotoType): boolean {
  return type === "follow_up_radiograph";
}

// ── Filtros y agrupaciones ──────────────────────────────────────────

interface ClinicalPhotoLike {
  module: ClinicalModule;
  patientId: string;
  photoType: ClinicalPhotoType;
  stage: ClinicalPhotoStage;
  capturedAt: Date;
  toothFdi: number | null;
}

/**
 * Filtra por (module, patientId).
 */
export function filterPhotosByPatient<T extends ClinicalPhotoLike>(
  photos: readonly T[],
  module: ClinicalModule,
  patientId: string,
): T[] {
  return photos.filter((p) => p.module === module && p.patientId === patientId);
}

/**
 * Agrupa fotos por fase implantológica. Solo aplica a tipos de implant set v2.
 * Los tipos del set v1 (implant_*) se mapean a la fase canónica.
 */
export function groupImplantPhotosByPhase<T extends ClinicalPhotoLike>(
  photos: readonly T[],
): Record<ImplantPhaseKey, T[]> {
  const out: Record<ImplantPhaseKey, T[]> = {
    planning: [],
    surgical: [],
    healing: [],
    second_stage: [],
    prosthetic: [],
    follow_up: [],
  };
  for (const p of photos) {
    if (p.module !== "implants") continue;
    const phase = implantPhotoTypeToImplantPhase(p.photoType);
    out[phase].push(p);
  }
  return out;
}

/**
 * Mapea un ClinicalPhotoType (set v1 o v2) a su fase implantológica.
 * Útil para timeline/comparativos.
 */
export function implantPhotoTypeToImplantPhase(
  type: ClinicalPhotoType,
): ImplantPhaseKey {
  switch (type) {
    case "implant_site_pre":
    case "pre_surgical":
      return "planning";
    case "implant_placement":
    case "surgical_phase":
      return "surgical";
    case "implant_healing":
      return "healing";
    case "second_stage":
      return "second_stage";
    case "implant_prosthetic":
    case "prosthetic_placement":
      return "prosthetic";
    case "follow_up_radiograph":
    case "peri_implant_check":
      return "follow_up";
    default:
      // re-usa helper general de types.ts para los del set v2
      if (isImplantPhotoType(type)) {
        return implantPhotoTypeToPhase(type);
      }
      return "follow_up";
  }
}

/**
 * Agrupa por (stage). Útil para vista comparativa antes/durante/después.
 */
export function groupPhotosByStage<T extends ClinicalPhotoLike>(
  photos: readonly T[],
): Record<ClinicalPhotoStage, T[]> {
  const out: Record<ClinicalPhotoStage, T[]> = {
    pre: [],
    during: [],
    post: [],
    control: [],
  };
  for (const p of photos) {
    out[p.stage].push(p);
  }
  return out;
}

/**
 * Ordena por capturedAt descendente.
 */
export function sortPhotosByDateDesc<T extends ClinicalPhotoLike>(
  photos: readonly T[],
): T[] {
  return [...photos].sort(
    (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime(),
  );
}

/**
 * Lista de tipos de foto válidos para un módulo dado. Útil para builder UI.
 */
export function allowedPhotoTypesForModule(
  module: ClinicalModule,
): ClinicalPhotoType[] {
  switch (module) {
    case "implants":
      return [
        ...IMPLANT_PHOTO_TYPES,
        "implant_site_pre",
        "implant_placement",
        "implant_prosthetic",
        "pre_treatment",
        "post_treatment",
        "other",
      ];
    case "endodontics":
      return ["endo_access", "endo_working_length", "endo_obturation", "other"];
    case "periodontics":
      return ["perio_initial", "perio_postsrp", "perio_surgery", "other"];
    case "orthodontics":
      return [
        "ortho_extraoral_front",
        "ortho_extraoral_profile",
        "ortho_intraoral",
        "ortho_progress",
        "other",
      ];
    case "pediatrics":
      return [
        "oral_general",
        "eruption_check",
        "sealant_pre",
        "sealant_post",
        "fluoride_app",
        "behavior_documentation",
        "other",
      ];
    default:
      return ["other"];
  }
}
