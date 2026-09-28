// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Ricketts, el
// resumen de 5 factores más línea E (Ricketts, R.M. "Cephalometric
// analysis and synthesis", Angle Orthod 1961 — valores de enseñanza muy
// repetidos en libros de texto posteriores, mismo criterio de cita que ya
// usa `../norms.ts`). Puro — sin Prisma, sin React.
//
// QUÉ NO CALCULA TODAVÍA: la "altura facial inferior" de Ricketts en su
// forma original (ángulo ANS-Xi-Pm) necesita los puntos construidos Xi
// (centro del ramo mandibular) y Pm (protuberancia del mentón), que no son
// puntos que se marquen con un clic — se CONSTRUYEN a partir del contorno
// óseo del ramo, y este trazado manual no pide ese contorno todavía. Se
// deja fuera en vez de improvisar una construcción de Xi/Pm sin fuente
// verificada — ver `CEPH_ANALYSIS_SCOPE_NOTE` en `../norms-extended.ts`.

import { angleBetweenLines, pxToMm, round1, signedDistanceToLine } from "../../geometria-plana";
import type { CephPoints } from "../landmarks";

export interface RickettsMeasurements {
  /** Ba-N vs Pt-Gn: dirección de crecimiento mandibular. */
  FACIAL_AXIS: number | null;
  /** FH vs N-Pog: qué tan vertical/horizontal es el crecimiento facial. */
  FACIAL_DEPTH: number | null;
  /** FH vs Go-Gn (variante de Ricketts del plano mandibular). */
  MANDIBULAR_PLANE_RICKETTS: number | null;
  /** Distancia del punto A al plano facial (N-Pog), con signo — mm, necesita calibración. */
  CONVEXITY_MM: number | null;
  /** Labio superior a la línea E (Prn-Pog'), con signo — mm, necesita calibración. */
  UPPER_LIP_E_MM: number | null;
  /** Labio inferior a la línea E (Prn-Pog'), con signo — mm, necesita calibración. */
  LOWER_LIP_E_MM: number | null;
}

const EMPTY: RickettsMeasurements = {
  FACIAL_AXIS: null,
  FACIAL_DEPTH: null,
  MANDIBULAR_PLANE_RICKETTS: null,
  CONVEXITY_MM: null,
  UPPER_LIP_E_MM: null,
  LOWER_LIP_E_MM: null,
};

/** Ver nota de signo en `steiner.ts`: aplica igual aquí (convexidad y línea E). */
export function computeRickettsMeasurements(
  points: CephPoints,
  pixelsPerMm?: number | null,
): RickettsMeasurements {
  const { BA, N, PT, GN, GO, OR, PO, PG, A, PRN, POG_SOFT, LS, LI } = points;

  const facialAxis = BA && N && PT && GN ? round1(angleBetweenLines(BA, N, PT, GN)) : null;
  const facialDepth = OR && PO && N && PG ? round1(angleBetweenLines(OR, PO, N, PG)) : null;
  const mandibularPlaneRicketts = OR && PO && GO && GN ? round1(angleBetweenLines(OR, PO, GO, GN)) : null;

  const convexityPx = A && N && PG ? round1(signedDistanceToLine(A, N, PG)) : null;
  const convexityMm = convexityPx !== null && pixelsPerMm ? pxToMm(convexityPx, pixelsPerMm) : null;

  const upperLipPx = LS && PRN && POG_SOFT ? round1(signedDistanceToLine(LS, PRN, POG_SOFT)) : null;
  const upperLipMm = upperLipPx !== null && pixelsPerMm ? pxToMm(upperLipPx, pixelsPerMm) : null;

  const lowerLipPx = LI && PRN && POG_SOFT ? round1(signedDistanceToLine(LI, PRN, POG_SOFT)) : null;
  const lowerLipMm = lowerLipPx !== null && pixelsPerMm ? pxToMm(lowerLipPx, pixelsPerMm) : null;

  if (
    facialAxis === null &&
    facialDepth === null &&
    mandibularPlaneRicketts === null &&
    convexityMm === null &&
    upperLipMm === null &&
    lowerLipMm === null
  ) {
    return { ...EMPTY };
  }

  return {
    FACIAL_AXIS: facialAxis,
    FACIAL_DEPTH: facialDepth,
    MANDIBULAR_PLANE_RICKETTS: mandibularPlaneRicketts,
    CONVEXITY_MM: convexityMm,
    UPPER_LIP_E_MM: upperLipMm,
    LOWER_LIP_E_MM: lowerLipMm,
  };
}
