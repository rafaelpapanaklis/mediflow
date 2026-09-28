// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Fuente única de
// qué dos puntos forman cada plano/línea de referencia clásico. La usan
// tanto los módulos de medidas de este archivo (`analyses/*.ts`) como —
// en la Parte B, cuando ws1-t4 integre la interfaz — el dibujo de los
// planos activables sobre la radiografía (requisito 4 del encargo): un
// plano que se puede DIBUJAR y uno que se puede MEDIR son la misma
// definición, nunca dos.
//
// Cada función devuelve `[a, b] | null`: null si falta cualquiera de los
// dos puntos que definen la línea. Ninguna inventa una posición.

import type { Point2D } from "../geometria-plana";
import type { CephPoints } from "./landmarks";

export type CephPlaneId =
  | "SN"
  | "FH"
  | "MANDIBULAR_GO_ME"
  | "MANDIBULAR_GO_GN"
  | "PALATAL"
  | "OCCLUSAL"
  | "NA"
  | "NB"
  | "N_POG"
  | "E_LINE"
  | "U1_AXIS"
  | "L1_AXIS"
  | "BA_N"
  | "PT_GN";

export interface CephPlaneDef {
  id: CephPlaneId;
  label: string;
  description: string;
}

export const CEPH_PLANES: CephPlaneDef[] = [
  { id: "SN", label: "Silla-Nasion (SN)", description: "Base de cráneo anterior — referencia de todas las medidas angulares al maxilar/mandíbula." },
  { id: "FH", label: "Frankfort (FH)", description: "Orbitario-Porion — horizontal de referencia." },
  { id: "MANDIBULAR_GO_ME", label: "Plano mandibular (Go-Me)", description: "Usado por FMA/IMPA (H1 básico) y Downs/Tweed." },
  { id: "MANDIBULAR_GO_GN", label: "Plano mandibular (Go-Gn)", description: "Usado por SN-GoGn (Steiner) y el plano mandibular de Ricketts." },
  { id: "PALATAL", label: "Plano palatino (ANS-PNS)", description: "Piso de la fosa nasal — referencia maxilar independiente de SN." },
  { id: "OCCLUSAL", label: "Plano oclusal", description: "Marcado directo (anterior-posterior) — referencia del ángulo interincisal." },
  { id: "NA", label: "Línea NA", description: "Nasion-A — referencia de la inclinación del incisivo superior (Steiner)." },
  { id: "NB", label: "Línea NB", description: "Nasion-B — referencia de la inclinación del incisivo inferior (Steiner)." },
  { id: "N_POG", label: "Plano facial (N-Pog)", description: "Nasion-Pogonion — referencia de convexidad facial (Ricketts) y facial depth." },
  { id: "E_LINE", label: "Línea E (Ricketts)", description: "Pronasal-Pogonion blando — referencia estética de los labios." },
  { id: "U1_AXIS", label: "Eje del incisivo superior", description: "Ápice-borde incisal del incisivo central superior." },
  { id: "L1_AXIS", label: "Eje del incisivo inferior", description: "Ápice-borde incisal del incisivo central inferior." },
  { id: "BA_N", label: "Basion-Nasion", description: "Usado por el eje facial de Ricketts." },
  { id: "PT_GN", label: "Pterigoideo-Gnation", description: "Usado por el eje facial de Ricketts." },
];

type Line = [Point2D, Point2D];

function line(a: Point2D | undefined, b: Point2D | undefined): Line | null {
  return a && b ? [a, b] : null;
}

/** Resuelve un plano a sus dos puntos, o null si el trazado aún no los tiene marcados. */
export function resolveCephPlane(id: CephPlaneId, points: CephPoints): Line | null {
  switch (id) {
    case "SN":
      return line(points.S, points.N);
    case "FH":
      return line(points.OR, points.PO);
    case "MANDIBULAR_GO_ME":
      return line(points.GO, points.ME);
    case "MANDIBULAR_GO_GN":
      return line(points.GO, points.GN);
    case "PALATAL":
      return line(points.ANS, points.PNS);
    case "OCCLUSAL":
      return line(points.OCC_ANT, points.OCC_POST);
    case "NA":
      return line(points.N, points.A);
    case "NB":
      return line(points.N, points.B);
    case "N_POG":
      return line(points.N, points.PG);
    case "E_LINE":
      return line(points.PRN, points.POG_SOFT);
    case "U1_AXIS":
      return line(points.U1_APEX, points.U1_TIP);
    case "L1_AXIS":
      return line(points.L1_APEX, points.L1_TIP);
    case "BA_N":
      return line(points.BA, points.N);
    case "PT_GN":
      return line(points.PT, points.GN);
    default:
      return null;
  }
}

/** Todos los planos que ya se pueden dibujar/medir con el trazado actual. */
export function availableCephPlanes(points: CephPoints): CephPlaneId[] {
  return CEPH_PLANES.filter((p) => resolveCephPlane(p.id, points) !== null).map((p) => p.id);
}
