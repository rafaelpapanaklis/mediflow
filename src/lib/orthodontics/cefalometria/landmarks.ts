// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, sep-2026). H1: puntos
// cefalométricos que el doctor marca a mano sobre la radiografía lateral de
// cráneo.
//
// v1 (H1 BÁSICO, ola 1): solo los 10 necesarios para SNA/SNB/ANB/FMA/IMPA.
// v2 (H1 COMPLETO, esta tarea — ws1-t8, "cefalometría de verdad"): el
// catálogo crece a los puntos habituales de un trazado completo (Steiner,
// Ricketts, McNamara, Downs/Tweed) SIN renombrar ni quitar ninguno de los
// 10 originales y SIN tocar `REQUIRED_CEPH_LANDMARKS` — así un trazado ya
// guardado con solo esos 10 sigue abriendo, siendo válido, y calculando
// exactamente las mismas 5 medidas que calculaba antes. Ver
// `__tests__/backward-compat.test.ts`.
//
// `CephPoints` sigue siendo `Partial<Record<...>>`: cualquier punto que
// falte dice "no marcado", nunca se inventa una posición.

import type { Point2D } from "../geometria-plana";

export type CephLandmarkId =
  // — v1 (H1 básico) —
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
  | "PG"
  // — v2 (H1 completo): más base de cráneo / maxilar / mandíbula —
  | "ANS"
  | "PNS"
  | "GN"
  | "AR"
  | "CO"
  | "BA"
  | "PT"
  // — v2: dentales que faltaban (incisivo superior, plano oclusal) —
  | "U1_TIP"
  | "U1_APEX"
  | "OCC_ANT"
  | "OCC_POST"
  // — v2: tejido blando (perfil) —
  | "PRN"
  | "SUBNASALE"
  | "LS"
  | "LI"
  | "POG_SOFT";

export type CephLandmarkCategory = "skeletal" | "dental" | "occlusal-plane" | "soft-tissue";

export interface CephLandmarkDef {
  id: CephLandmarkId;
  label: string;
  description: string;
  category: CephLandmarkCategory;
  /** false = catálogo clásico pero no usado por las 5 medidas de H1 básico. */
  requiredForCore: boolean;
}

export const CEPH_LANDMARKS: CephLandmarkDef[] = [
  // — v1: los 10 de H1 básico (SNA/SNB/ANB/FMA/IMPA) —
  { id: "S", label: "Silla (S)", description: "Centro geométrico de la silla turca.", category: "skeletal", requiredForCore: true },
  { id: "N", label: "Nasion (N)", description: "Punto más anterior de la sutura frontonasal.", category: "skeletal", requiredForCore: true },
  { id: "A", label: "Punto A", description: "Punto más profundo de la concavidad anterior del maxilar.", category: "skeletal", requiredForCore: true },
  { id: "B", label: "Punto B", description: "Punto más profundo de la concavidad anterior de la mandíbula.", category: "skeletal", requiredForCore: true },
  { id: "GO", label: "Gonion (Go)", description: "Punto más posteroinferior del ángulo mandibular.", category: "skeletal", requiredForCore: true },
  { id: "ME", label: "Mentón (Me)", description: "Punto más inferior de la sínfisis mandibular.", category: "skeletal", requiredForCore: true },
  { id: "OR", label: "Orbitario (Or)", description: "Punto más bajo del reborde orbitario (plano de Frankfort).", category: "skeletal", requiredForCore: true },
  { id: "PO", label: "Porion (Po)", description: "Punto más alto del conducto auditivo externo (plano de Frankfort).", category: "skeletal", requiredForCore: true },
  { id: "L1_TIP", label: "Borde incisal — incisivo inferior", description: "Punta del incisivo central inferior más prominente.", category: "dental", requiredForCore: true },
  { id: "L1_APEX", label: "Ápice — incisivo inferior", description: "Ápice radicular del mismo incisivo.", category: "dental", requiredForCore: true },
  { id: "PG", label: "Pogonion (Pg)", description: "Punto más anterior del mentón óseo.", category: "skeletal", requiredForCore: false },

  // — v2: base de cráneo / maxilar / mandíbula que agrega Ricketts/McNamara —
  { id: "ANS", label: "Espina nasal anterior (ANS)", description: "Punta ósea más anterior del piso de la fosa nasal.", category: "skeletal", requiredForCore: false },
  { id: "PNS", label: "Espina nasal posterior (PNS)", description: "Punto más posterior del piso de la fosa nasal (con ANS define el plano palatino).", category: "skeletal", requiredForCore: false },
  { id: "GN", label: "Gnation (Gn)", description: "Punto más anteroinferior del contorno óseo del mentón, entre Pogonion y Mentón.", category: "skeletal", requiredForCore: false },
  { id: "AR", label: "Articular (Ar)", description: "Intersección del borde posterior del cóndilo con el borde inferior de la base occipital.", category: "skeletal", requiredForCore: false },
  { id: "CO", label: "Condylion (Co)", description: "Punto más posterosuperior del contorno del cóndilo mandibular.", category: "skeletal", requiredForCore: false },
  { id: "BA", label: "Basion (Ba)", description: "Punto más inferior del borde anterior del foramen magno.", category: "skeletal", requiredForCore: false },
  { id: "PT", label: "Punto pterigoideo (Pt)", description: "Intersección del borde posterior de la fisura pterigomaxilar con el borde inferior del foramen redondo.", category: "skeletal", requiredForCore: false },

  // — v2: dentales que completan el trazado (Steiner) —
  { id: "U1_TIP", label: "Borde incisal — incisivo superior", description: "Punta del incisivo central superior más prominente.", category: "dental", requiredForCore: false },
  { id: "U1_APEX", label: "Ápice — incisivo superior", description: "Ápice radicular del mismo incisivo.", category: "dental", requiredForCore: false },
  { id: "OCC_ANT", label: "Plano oclusal — anterior", description: "Punto anterior del plano oclusal funcional (traslape de los incisivos).", category: "occlusal-plane", requiredForCore: false },
  { id: "OCC_POST", label: "Plano oclusal — posterior", description: "Punto posterior del plano oclusal funcional (cúspides de primeros molares).", category: "occlusal-plane", requiredForCore: false },

  // — v2: tejido blando del perfil (Ricketts / línea E) —
  { id: "PRN", label: "Pronasal (Prn)", description: "Punto más prominente de la punta de la nariz.", category: "soft-tissue", requiredForCore: false },
  { id: "SUBNASALE", label: "Subnasal (Sn)", description: "Unión de la columela con el labio superior.", category: "soft-tissue", requiredForCore: false },
  { id: "LS", label: "Labio superior (Ls)", description: "Punto más prominente del borde bermellón del labio superior.", category: "soft-tissue", requiredForCore: false },
  { id: "LI", label: "Labio inferior (Li)", description: "Punto más prominente del borde bermellón del labio inferior.", category: "soft-tissue", requiredForCore: false },
  { id: "POG_SOFT", label: "Pogonion blando (Pog')", description: "Punto más anterior del contorno de tejido blando del mentón.", category: "soft-tissue", requiredForCore: false },
];

export const REQUIRED_CEPH_LANDMARKS: CephLandmarkId[] = CEPH_LANDMARKS.filter(
  (l) => l.requiredForCore,
).map((l) => l.id);

export type CephPoints = Partial<Record<CephLandmarkId, Point2D>>;

/** Puntos del catálogo requerido (H1 básico) que aún no se han marcado. */
export function missingCephLandmarks(points: CephPoints): CephLandmarkId[] {
  return REQUIRED_CEPH_LANDMARKS.filter((id) => !points[id]);
}

export function isCephTracingComplete(points: CephPoints): boolean {
  return missingCephLandmarks(points).length === 0;
}

/** Catálogo agrupado por categoría, en el orden de `CEPH_LANDMARKS` — para la guía visual de marcado (Parte B, ws1-t4). */
export function cephLandmarksByCategory(): Record<CephLandmarkCategory, CephLandmarkDef[]> {
  const groups: Record<CephLandmarkCategory, CephLandmarkDef[]> = {
    skeletal: [],
    dental: [],
    "occlusal-plane": [],
    "soft-tissue": [],
  };
  for (const l of CEPH_LANDMARKS) groups[l.category].push(l);
  return groups;
}

export function findCephLandmark(id: CephLandmarkId): CephLandmarkDef {
  const def = CEPH_LANDMARKS.find((l) => l.id === id);
  if (!def) throw new Error(`Punto cefalométrico desconocido: ${id}`);
  return def;
}
