// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, sep-2026). H5: análisis
// de fotos con líneas — línea E, ángulo nasolabial y línea media. Puro —
// sin Prisma, sin React. La calibración a mm es opcional: sin ella se
// reportan px (útil solo como comparación relativa entre visitas de la
// MISMA foto/zoom; con calibración de una referencia conocida en la foto,
// se convierte a mm).

import { angleAtVertex, pxToMm, signedDistanceToLine } from "../geometria-plana";
import type { FacialPoints } from "./landmarks";

export interface ELineResult {
  upperLipPx: number | null;
  lowerLipPx: number | null;
  upperLipMm: number | null;
  lowerLipMm: number | null;
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
    return { upperLipPx: null, lowerLipPx: null, upperLipMm: null, lowerLipMm: null };
  }
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
}

/** Desviación de la línea media dental respecto a la línea media facial (glabela → mentón). */
export function computeMidlineDeviation(points: FacialPoints, pixelsPerMm?: number): MidlineResult {
  const { GLABELLA, MENTON_SOFT, DENTAL_MIDLINE } = points;
  if (!GLABELLA || !MENTON_SOFT || !DENTAL_MIDLINE) return { deviationPx: null, deviationMm: null };
  const deviationPx = round1(signedDistanceToLine(DENTAL_MIDLINE, GLABELLA, MENTON_SOFT));
  return {
    deviationPx,
    deviationMm: pixelsPerMm ? pxToMm(Math.abs(deviationPx), pixelsPerMm) : null,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
