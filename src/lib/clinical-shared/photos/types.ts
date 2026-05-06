// Clinical-shared — tipos públicos para ClinicalPhoto.

import type { ClinicalModule, ClinicalPhotoStage, ClinicalPhotoType } from "@prisma/client";

export type { ClinicalModule, ClinicalPhotoStage, ClinicalPhotoType };

export interface ClinicalPhotoDTO {
  id: string;
  patientId: string;
  module: ClinicalModule;
  toothFdi: number | null;
  photoType: ClinicalPhotoType;
  stage: ClinicalPhotoStage;
  capturedAt: string; // ISO
  capturedBy: string;
  blobUrl: string;
  thumbnailUrl: string | null;
  notes: string | null;
  annotations: PhotoAnnotation[] | null;
}

export interface PhotoAnnotation {
  // Coordenadas relativas (0..1) sobre la foto
  x: number;
  y: number;
  // Texto libre (eg. "diente 51 erupcionando", "fluorosis leve")
  label: string;
  // Color del marcador
  color?: string;
}

/** Subconjunto de ClinicalPhotoType que aplica a Pediatría. */
export const PEDIATRIC_PHOTO_TYPES = [
  "oral_general",
  "eruption_check",
  "sealant_pre",
  "sealant_post",
  "fluoride_app",
  "behavior_documentation",
] as const satisfies readonly ClinicalPhotoType[];

export type PediatricPhotoType = (typeof PEDIATRIC_PHOTO_TYPES)[number];

export const PEDIATRIC_PHOTO_TYPE_LABELS: Record<PediatricPhotoType, string> = {
  oral_general: "Bucal general",
  eruption_check: "Control de erupción",
  sealant_pre: "Sellante (pre)",
  sealant_post: "Sellante (post)",
  fluoride_app: "Aplicación de flúor",
  behavior_documentation: "Documentación conductual",
};

export const STAGE_LABELS: Record<ClinicalPhotoStage, string> = {
  pre: "Antes",
  during: "Durante",
  post: "Después",
  control: "Control",
};
