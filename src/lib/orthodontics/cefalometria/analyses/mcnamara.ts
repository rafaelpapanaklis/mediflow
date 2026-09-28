// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). McNamara (1984),
// las medidas lineales de longitud efectiva y posición anteroposterior.
// Puro — sin Prisma, sin React. TODAS necesitan calibración (son mm) —
// sin ella, todos los campos salen `null`.
//
// Las normas de McNamara son fuertemente dependientes de EDAD y SEXO (Co-A,
// Co-Gn, el diferencial maxilomandibular y la altura facial anteroinferior
// cambian con el crecimiento). Este archivo calcula los valores; las
// normas de referencia — cuando las hay sin ajuste por edad — viven en
// `../norms-extended.ts`, y donde no hay un número seguro para citar se
// deja `null` ahí en vez de inventar una tabla de edad/sexo.

import { distance, pxToMm, round1, signedDistanceToPerpendicularLine } from "../../geometria-plana";
import type { CephPoints } from "../landmarks";

export interface McNamaraMeasurements {
  /** Punto A a la vertical N-perpendicular (perpendicular a FH que pasa por N) — mm. */
  A_TO_NPERP_MM: number | null;
  /** Pogonion a la misma vertical N-perpendicular — mm. */
  PG_TO_NPERP_MM: number | null;
  /** Longitud efectiva del maxilar: Condylion-A — mm. */
  CO_A_MM: number | null;
  /** Longitud efectiva de la mandíbula: Condylion-Gnation — mm. */
  CO_GN_MM: number | null;
  /** Diferencial maxilomandibular: Co-Gn menos Co-A — mm. */
  MAXMAND_DIFFERENTIAL_MM: number | null;
  /** Altura facial anteroinferior: ANS-Mentón — mm. */
  LOWER_FACE_HEIGHT_MM: number | null;
}

const EMPTY: McNamaraMeasurements = {
  A_TO_NPERP_MM: null,
  PG_TO_NPERP_MM: null,
  CO_A_MM: null,
  CO_GN_MM: null,
  MAXMAND_DIFFERENTIAL_MM: null,
  LOWER_FACE_HEIGHT_MM: null,
};

export function computeMcNamaraMeasurements(
  points: CephPoints,
  pixelsPerMm?: number | null,
): McNamaraMeasurements {
  if (!pixelsPerMm) return { ...EMPTY };

  const { N, OR, PO, A, PG, CO, GN, ANS, ME } = points;

  const aToNperpPx = A && N && OR && PO ? round1(signedDistanceToPerpendicularLine(A, N, OR, PO)) : null;
  const aToNperpMm = aToNperpPx !== null ? pxToMm(aToNperpPx, pixelsPerMm) : null;

  const pgToNperpPx = PG && N && OR && PO ? round1(signedDistanceToPerpendicularLine(PG, N, OR, PO)) : null;
  const pgToNperpMm = pgToNperpPx !== null ? pxToMm(pgToNperpPx, pixelsPerMm) : null;

  const coAPx = CO && A ? round1(distance(CO, A)) : null;
  const coAMm = coAPx !== null ? pxToMm(coAPx, pixelsPerMm) : null;

  const coGnPx = CO && GN ? round1(distance(CO, GN)) : null;
  const coGnMm = coGnPx !== null ? pxToMm(coGnPx, pixelsPerMm) : null;

  const differentialMm = coAMm !== null && coGnMm !== null ? round1(coGnMm - coAMm) : null;

  const lowerFaceHeightPx = ANS && ME ? round1(distance(ANS, ME)) : null;
  const lowerFaceHeightMm = lowerFaceHeightPx !== null ? pxToMm(lowerFaceHeightPx, pixelsPerMm) : null;

  return {
    A_TO_NPERP_MM: aToNperpMm,
    PG_TO_NPERP_MM: pgToNperpMm,
    CO_A_MM: coAMm,
    CO_GN_MM: coGnMm,
    MAXMAND_DIFFERENTIAL_MM: differentialMm,
    LOWER_FACE_HEIGHT_MM: lowerFaceHeightMm,
  };
}
