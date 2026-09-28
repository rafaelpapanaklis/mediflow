// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, sep-2026). H1: puntos
// cefalométricos que el doctor marca a mano sobre la radiografía lateral de
// cráneo. Solo los necesarios para SNA/SNB/ANB/FMA/IMPA — el catálogo puede
// crecer en v1.1 sin romper trazados ya guardados (Partial<Record<...>>).

import type { Point2D } from "../geometria-plana";

export type CephLandmarkId =
  | "S"
  | "N"
  | "A"
  | "B"
  | "ME"
  | "GO"
  | "OR"
  | "PO"
  | "L1_TIP"
  | "L1_APEX"
  | "PG";

export interface CephLandmarkDef {
  id: CephLandmarkId;
  label: string;
  description: string;
  /** false = catálogo clásico pero no usado por las 5 medidas de H1 todavía. */
  requiredForCore: boolean;
}

export const CEPH_LANDMARKS: CephLandmarkDef[] = [
  { id: "S", label: "Silla (S)", description: "Centro geométrico de la silla turca.", requiredForCore: true },
  { id: "N", label: "Nasion (N)", description: "Punto más anterior de la sutura frontonasal.", requiredForCore: true },
  { id: "A", label: "Punto A", description: "Punto más profundo de la concavidad anterior del maxilar.", requiredForCore: true },
  { id: "B", label: "Punto B", description: "Punto más profundo de la concavidad anterior de la mandíbula.", requiredForCore: true },
  { id: "GO", label: "Gonion (Go)", description: "Punto más posteroinferior del ángulo mandibular.", requiredForCore: true },
  { id: "ME", label: "Mentón (Me)", description: "Punto más inferior de la sínfisis mandibular.", requiredForCore: true },
  { id: "OR", label: "Orbitario (Or)", description: "Punto más bajo del reborde orbitario (plano de Frankfort).", requiredForCore: true },
  { id: "PO", label: "Porion (Po)", description: "Punto más alto del conducto auditivo externo (plano de Frankfort).", requiredForCore: true },
  { id: "L1_TIP", label: "Borde incisal — incisivo inferior", description: "Punta del incisivo central inferior más prominente.", requiredForCore: true },
  { id: "L1_APEX", label: "Ápice — incisivo inferior", description: "Ápice radicular del mismo incisivo.", requiredForCore: true },
  { id: "PG", label: "Pogonion (Pg)", description: "Punto más anterior del mentón óseo. Reservado para métricas futuras (convexidad facial).", requiredForCore: false },
];

export const REQUIRED_CEPH_LANDMARKS: CephLandmarkId[] = CEPH_LANDMARKS.filter(
  (l) => l.requiredForCore,
).map((l) => l.id);

export type CephPoints = Partial<Record<CephLandmarkId, Point2D>>;

/** Puntos del catálogo requerido que aún no se han marcado. */
export function missingCephLandmarks(points: CephPoints): CephLandmarkId[] {
  return REQUIRED_CEPH_LANDMARKS.filter((id) => !points[id]);
}

export function isCephTracingComplete(points: CephPoints): boolean {
  return missingCephLandmarks(points).length === 0;
}
