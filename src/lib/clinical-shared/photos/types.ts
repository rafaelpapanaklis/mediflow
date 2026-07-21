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

/** Subconjunto de ClinicalPhotoType para el módulo `general` (tab "Fotos
 *  clínicas" de la ficha): vistas extraorales e intraorales estándar. */
export const GENERAL_EXTRAORAL_PHOTO_TYPES = [
  "extraoral_front",
  "extraoral_smile",
  "extraoral_profile_right",
  "extraoral_profile_left",
] as const satisfies readonly ClinicalPhotoType[];

export const GENERAL_INTRAORAL_PHOTO_TYPES = [
  "intraoral_front",
  "intraoral_lateral_right",
  "intraoral_lateral_left",
  "occlusal_upper",
  "occlusal_lower",
] as const satisfies readonly ClinicalPhotoType[];

export const GENERAL_PHOTO_TYPES = [
  ...GENERAL_EXTRAORAL_PHOTO_TYPES,
  ...GENERAL_INTRAORAL_PHOTO_TYPES,
] as const satisfies readonly ClinicalPhotoType[];

export type GeneralPhotoType = (typeof GENERAL_PHOTO_TYPES)[number];

export const GENERAL_PHOTO_TYPE_LABELS: Record<GeneralPhotoType, string> = {
  extraoral_front: "Extraoral frontal",
  extraoral_smile: "Extraoral sonrisa",
  extraoral_profile_right: "Perfil derecho",
  extraoral_profile_left: "Perfil izquierdo",
  intraoral_front: "Intraoral frontal",
  intraoral_lateral_right: "Intraoral lateral derecha",
  intraoral_lateral_left: "Intraoral lateral izquierda",
  occlusal_upper: "Oclusal superior",
  occlusal_lower: "Oclusal inferior",
};
