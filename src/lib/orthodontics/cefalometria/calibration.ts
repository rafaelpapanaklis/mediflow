// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Calibración a
// milímetros: el doctor marca dos puntos sobre una distancia conocida de
// la propia placa (la bolita/regla que trae casi toda radiografía lateral
// digital, o cualquier referencia de tamaño real que el doctor sepa) y
// teclea esa distancia en mm. De ahí sale px/mm, que es lo que
// `calibrationMmPerPixel` ya guarda en el modelo (`sql/ortodoncia-
// cefalometria.sql`, columna existente desde H1 básico — no es un campo
// nuevo).
//
// Sin calibración, las medidas ANGULARES (SNA, SNB, ANB, FMA, IMPA, SN-GoGn,
// ángulo interincisal, ejes U1/L1…) se calculan igual: un ángulo no
// necesita escala. Lo que se queda en blanco sin calibrar son las medidas
// LINEALES en mm (U1-NA mm, L1-NB mm, convexidad, Co-A, Co-Gn, línea E…) —
// nunca se reporta un mm inventado a partir de una escala supuesta.
//
// OJO al nombre del campo del modelo, `calibrationMmPerPixel`: el propio
// comentario `///` de `schema.prisma` encima de él dice "px por mm" — o
// sea que pese al nombre, lo que se guarda (y lo que espera `pxToMm` de
// `geometria-plana.ts`, ya usado por H5/fotos) es PX POR MM, no mm por px.
// Aquí no se renombra el campo (es de otra parte del reparto y ya tiene
// datos reales guardándose); se documenta la trampa y la función de este
// archivo se llama por lo que de verdad calcula.

import { distance, round2, type Point2D } from "../geometria-plana";

export interface CalibrationPoints {
  /** Un extremo de la distancia conocida marcada en la placa. */
  a: Point2D;
  /** El otro extremo. */
  b: Point2D;
}

export interface CalibrationInput {
  points: CalibrationPoints | null;
  /** Distancia real, en mm, entre `points.a` y `points.b` (la que teclea el doctor). */
  knownDistanceMm: number | null;
}

/**
 * px por mm (no mm por px — ver nota de arriba) a partir de dos puntos
 * marcados y la distancia real que representan. `null` si falta cualquiera
 * de las tres partes o si la distancia en px o en mm es cero/negativa (dos
 * clics en el mismo sitio, o un valor tecleado inválido) — nunca una
 * división que produzca Infinity o NaN silencioso. El resultado es lo que
 * va directo al campo `calibrationMmPerPixel` y a `pxToMm(px, pixelsPerMm)`.
 */
export function computeCalibrationPxPerMm(input: CalibrationInput): number | null {
  const { points, knownDistanceMm } = input;
  if (!points || !knownDistanceMm || knownDistanceMm <= 0) return null;
  const px = distance(points.a, points.b);
  if (px <= 0) return null;
  return round2(px / knownDistanceMm);
}

/** mm → px, usando la misma calibración (para dibujar una regla de referencia en la UI). */
export function mmToPx(mm: number, pixelsPerMm: number): number | null {
  if (!pixelsPerMm || pixelsPerMm <= 0) return null;
  return round2(mm * pixelsPerMm);
}
