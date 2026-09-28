// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, sep-2026; geometría
// corregida ws1-t10, H19). H5: análisis de fotos con líneas — línea E,
// ángulo nasolabial y línea media.
//
// Puro — sin Prisma, sin React. Los puntos que recibe YA vienen en px
// NATURALES de la foto (ver PhotoLineAnalyzer/image-coords.ts): un "px" de
// aquí siempre significa lo mismo en x y en y, sin deformar.
//
// Unidades (H19): un conteo de px crudo no es una unidad clínica — el
// mismo perfil fotografiado más cerca o con más zoom da otro número sin que
// el paciente haya cambiado. Por eso además de *Px se calcula *Ratio, la
// proporción respecto al segmento de referencia (línea E o línea media)
// DENTRO de la misma foto: invariante a escala/zoom sin necesitar
// calibración. *Mm solo sale si hay una calibración px/mm de una
// referencia conocida en la foto — mientras no exista, la UI muestra
// ángulos y proporciones, nunca "px" a secas.

import { angleAtVertex, distance, pxToMm, signedDistanceToLine } from "../geometria-plana";
import type { FacialPoints } from "./landmarks";

export interface ELineResult {
  upperLipPx: number | null;
  lowerLipPx: number | null;
  upperLipMm: number | null;
  lowerLipMm: number | null;
  /** Proporción respecto a la longitud de la línea E (punta de nariz → mentón), invariante a escala. */
  upperLipRatio: number | null;
  lowerLipRatio: number | null;
}

/**
 * Distancia con signo del labio superior/inferior a la línea E (punta de
 * nariz → mentón de tejido blando). Negativo = labio por detrás de la
 * línea E (retruido); positivo = por delante (protruido) — el signo exacto
 * depende de la orientación de la foto (paciente mirando a la izq. o
 * derecha), así que la UI decide cómo rotularlo según el lado del perfil.
 */
export function computeELine(points: FacialPoints, pixelsPerMm?: number): ELineResult {
  const { PRONASALE, SOFT_POGONION, LABRALE_SUPERIUS, LABRALE_INFERIUS } = points;
  if (!PRONASALE || !SOFT_POGONION) {
    return {
      upperLipPx: null,
      lowerLipPx: null,
      upperLipMm: null,
      lowerLipMm: null,
      upperLipRatio: null,
      lowerLipRatio: null,
    };
  }
  const referenceLengthPx = distance(PRONASALE, SOFT_POGONION);
  const upperLipPx = LABRALE_SUPERIUS
    ? round1(signedDistanceToLine(LABRALE_SUPERIUS, PRONASALE, SOFT_POGONION))
    : null;
  const lowerLipPx = LABRALE_INFERIUS
    ? round1(signedDistanceToLine(LABRALE_INFERIUS, PRONASALE, SOFT_POGONION))
    : null;
  return {
    upperLipPx,
    lowerLipPx,
    upperLipMm: upperLipPx !== null && pixelsPerMm ? pxToMm(upperLipPx, pixelsPerMm) : null,
    lowerLipMm: lowerLipPx !== null && pixelsPerMm ? pxToMm(lowerLipPx, pixelsPerMm) : null,
    upperLipRatio: upperLipPx !== null ? ratio(upperLipPx, referenceLengthPx) : null,
    lowerLipRatio: lowerLipPx !== null ? ratio(lowerLipPx, referenceLengthPx) : null,
  };
}

/** Ángulo nasolabial: entre la tangente a la columela y el labio superior, con vértice en subnasal. Norma ~90-110°. */
export function computeNasolabialAngle(points: FacialPoints): number | null {
  const { SUBNASALE, COLUMELLA, LABRALE_SUPERIUS } = points;
  if (!SUBNASALE || !COLUMELLA || !LABRALE_SUPERIUS) return null;
  return round1(angleAtVertex(SUBNASALE, COLUMELLA, LABRALE_SUPERIUS));
}

export interface MidlineResult {
  deviationPx: number | null;
  deviationMm: number | null;
  /** Proporción respecto a la longitud glabela→mentón, invariante a escala. */
  deviationRatio: number | null;
}

/** Desviación de la línea media dental respecto a la línea media facial (glabela → mentón). */
export function computeMidlineDeviation(points: FacialPoints, pixelsPerMm?: number): MidlineResult {
  const { GLABELLA, MENTON_SOFT, DENTAL_MIDLINE } = points;
  if (!GLABELLA || !MENTON_SOFT || !DENTAL_MIDLINE) {
    return { deviationPx: null, deviationMm: null, deviationRatio: null };
  }
  const referenceLengthPx = distance(GLABELLA, MENTON_SOFT);
  const deviationPx = round1(signedDistanceToLine(DENTAL_MIDLINE, GLABELLA, MENTON_SOFT));
  return {
    deviationPx,
    deviationMm: pixelsPerMm ? pxToMm(Math.abs(deviationPx), pixelsPerMm) : null,
    deviationRatio: ratio(deviationPx, referenceLengthPx),
  };
}

export interface FacialAnalysisMeasurements {
  eLine: ELineResult;
  nasolabialAngle: number | null;
  midline: MidlineResult;
}

/**
 * Todas las medidas de una vista en un solo objeto — lo que el servidor
 * recalcula y guarda en `measurements` al hacer `saveFacialAnalysis`.
 * Nunca se confía en un número que mande el cliente.
 */
export function computeFacialMeasurements(points: FacialPoints, pixelsPerMm?: number): FacialAnalysisMeasurements {
  return {
    eLine: computeELine(points, pixelsPerMm),
    nasolabialAngle: computeNasolabialAngle(points),
    midline: computeMidlineDeviation(points, pixelsPerMm),
  };
}

/** Proporción con signo de `valuePx` respecto a `referenceLengthPx`; null si la referencia mide 0. */
function ratio(valuePx: number, referenceLengthPx: number): number | null {
  if (!referenceLengthPx) return null;
  return round3(valuePx / referenceLengthPx);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
