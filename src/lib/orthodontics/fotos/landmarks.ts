// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, sep-2026). H5: puntos
// que el doctor marca sobre las fotos de perfil y de frente para línea E,
// ángulo nasolabial y línea media. Catálogo mínimo pedido por el alcance;
// arco de sonrisa y corredores bucales quedan para una vuelta futura.

import type { Point2D } from "../geometria-plana";

export type FacialLandmarkId =
  | "PRONASALE"
  | "SOFT_POGONION"
  | "SUBNASALE"
  | "COLUMELLA"
  | "LABRALE_SUPERIUS"
  | "LABRALE_INFERIUS"
  | "GLABELLA"
  | "MENTON_SOFT"
  | "DENTAL_MIDLINE";

export interface FacialLandmarkDef {
  id: FacialLandmarkId;
  label: string;
  description: string;
  /** En qué foto de la serie se marca habitualmente. */
  view: "perfil" | "frente";
}

export const FACIAL_LANDMARKS: FacialLandmarkDef[] = [
  { id: "PRONASALE", label: "Punta de la nariz", description: "Punto más prominente de la nariz.", view: "perfil" },
  { id: "SOFT_POGONION", label: "Mentón (tejido blando)", description: "Punto más anterior del mentón en tejido blando.", view: "perfil" },
  { id: "SUBNASALE", label: "Subnasal", description: "Unión de la columela con el labio superior.", view: "perfil" },
  { id: "COLUMELLA", label: "Columela", description: "Punto sobre la columela, arriba de subnasal, para trazar su tangente.", view: "perfil" },
  { id: "LABRALE_SUPERIUS", label: "Labio superior", description: "Punto más prominente del borde del labio superior.", view: "perfil" },
  { id: "LABRALE_INFERIUS", label: "Labio inferior", description: "Punto más prominente del borde del labio inferior.", view: "perfil" },
  { id: "GLABELLA", label: "Glabela", description: "Punto medio entre las cejas — referencia superior de la línea media facial.", view: "frente" },
  { id: "MENTON_SOFT", label: "Mentón (frente)", description: "Punto más bajo del mentón en tejido blando, visto de frente.", view: "frente" },
  { id: "DENTAL_MIDLINE", label: "Línea media dental", description: "Punto entre los incisivos centrales superiores, con la sonrisa.", view: "frente" },
];

export type FacialPoints = Partial<Record<FacialLandmarkId, Point2D>>;

export const ELINE_LANDMARKS: FacialLandmarkId[] = [
  "PRONASALE",
  "SOFT_POGONION",
  "LABRALE_SUPERIUS",
  "LABRALE_INFERIUS",
];

export const NASOLABIAL_LANDMARKS: FacialLandmarkId[] = ["SUBNASALE", "COLUMELLA", "LABRALE_SUPERIUS"];

export const MIDLINE_LANDMARKS: FacialLandmarkId[] = ["GLABELLA", "MENTON_SOFT", "DENTAL_MIDLINE"];
