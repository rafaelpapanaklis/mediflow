// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Steiner (1953),
// las medidas que le faltaban al H1 básico (que ya tenía SNA/SNB/ANB, en
// `../measurements.ts`, sin tocar). Puro — sin Prisma, sin React.
//
// Las medidas EN mm (U1-NA, L1-NB) se reportan CON signo, mismo criterio
// que ya usa `../../fotos/facial-analysis.ts` (`computeELine`) para la
// línea E: el signo indica de qué lado de la línea cae el punto, pero cuál
// lado es "labial/protruido" depende de si la radiografía se trazó con el
// perfil mirando a la izquierda o a la derecha — este trazado manual no
// fuerza una convención de orientación, así que quien rotule el número
// (UI o PDF) decide "labial"/"lingual" mirando la imagen, no el signo a
// ciegas.

import { angleBetweenLines, pxToMm, round1, signedDistanceToLine } from "../../geometria-plana";
import type { CephPoints } from "../landmarks";

export interface SteinerExtraMeasurements {
  /** SN vs Go-Gn: patrón de crecimiento facial (variante de Steiner al FMA de H1, que usa Go-Me). */
  SN_GOGN: number | null;
  /** Inclinación del incisivo superior respecto a NA — ángulo. */
  U1_NA_DEG: number | null;
  /** Inclinación del incisivo superior respecto a NA — mm (necesita calibración). */
  U1_NA_MM: number | null;
  /** Inclinación del incisivo inferior respecto a NB — ángulo. */
  L1_NB_DEG: number | null;
  /** Inclinación del incisivo inferior respecto a NB — mm (necesita calibración). */
  L1_NB_MM: number | null;
  /** Ángulo entre los ejes de ambos incisivos centrales. */
  INTERINCISAL: number | null;
  /** Plano oclusal marcado vs SN. */
  OCCLUSAL_SN: number | null;
}

const EMPTY: SteinerExtraMeasurements = {
  SN_GOGN: null,
  U1_NA_DEG: null,
  U1_NA_MM: null,
  L1_NB_DEG: null,
  L1_NB_MM: null,
  INTERINCISAL: null,
  OCCLUSAL_SN: null,
};

/**
 * `pixelsPerMm`: px por 1mm (ver nota de `../calibration.ts` sobre el
 * nombre engañoso del campo `calibrationMmPerPixel`). `null`/`undefined` =
 * sin calibrar: las medidas en mm quedan `null`, las angulares se calculan
 * igual.
 */
export function computeSteinerExtras(
  points: CephPoints,
  pixelsPerMm?: number | null,
): SteinerExtraMeasurements {
  const { S, N, A, B, GO, GN, U1_TIP, U1_APEX, L1_TIP, L1_APEX, OCC_ANT, OCC_POST } = points;

  const snGoGn = S && N && GO && GN ? round1(angleBetweenLines(S, N, GO, GN)) : null;

  const u1NaDeg = U1_APEX && U1_TIP && N && A ? round1(angleBetweenLines(U1_APEX, U1_TIP, N, A)) : null;
  const u1NaMmPx = U1_TIP && N && A ? round1(signedDistanceToLine(U1_TIP, N, A)) : null;
  const u1NaMm = u1NaMmPx !== null && pixelsPerMm ? pxToMm(u1NaMmPx, pixelsPerMm) : null;

  const l1NbDeg = L1_APEX && L1_TIP && N && B ? round1(angleBetweenLines(L1_APEX, L1_TIP, N, B)) : null;
  const l1NbMmPx = L1_TIP && N && B ? round1(signedDistanceToLine(L1_TIP, N, B)) : null;
  const l1NbMm = l1NbMmPx !== null && pixelsPerMm ? pxToMm(l1NbMmPx, pixelsPerMm) : null;

  const interincisal =
    U1_APEX && U1_TIP && L1_APEX && L1_TIP
      ? round1(angleBetweenLines(U1_APEX, U1_TIP, L1_APEX, L1_TIP))
      : null;

  const occlusalSn = OCC_ANT && OCC_POST && S && N ? round1(angleBetweenLines(OCC_ANT, OCC_POST, S, N)) : null;

  if (
    snGoGn === null &&
    u1NaDeg === null &&
    u1NaMm === null &&
    l1NbDeg === null &&
    l1NbMm === null &&
    interincisal === null &&
    occlusalSn === null
  ) {
    return { ...EMPTY };
  }

  return {
    SN_GOGN: snGoGn,
    U1_NA_DEG: u1NaDeg,
    U1_NA_MM: u1NaMm,
    L1_NB_DEG: l1NbDeg,
    L1_NB_MM: l1NbMm,
    INTERINCISAL: interincisal,
    OCCLUSAL_SN: occlusalSn,
  };
}
