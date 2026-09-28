// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Triángulo de
// Tweed (Tweed, C.H. 1954): FMA + FMIA + IMPA = 180° siempre, por
// construcción geométrica (los tres ángulos de un triángulo formado por
// el plano de Frankfort, el plano mandibular y el eje del incisivo
// inferior). FMA e IMPA YA los calcula `../measurements.ts` (H1 básico,
// sin tocar) — aquí solo se deriva FMIA, que es el tercer lado del mismo
// triángulo y no necesita ningún punto nuevo que FMA/IMPA no usen ya.
//
// Downs (Downs, W.B. 1948) no agrega una medida propia más allá de lo que
// ya cubren SNA/SNB/ANB/FMA/convexidad — se deja como referencia cruzada,
// igual que Ricketts/McNamara ya hacían con esas 3 en `../norms.ts`.

import { round1 } from "../../geometria-plana";
import type { CephMeasurements } from "../measurements";

export interface DownsTweedMeasurements {
  /** Frankfort-Mandibular Incisor Angle: FH vs eje del incisivo inferior. */
  FMIA: number | null;
}

/** Necesita FMA e IMPA ya calculados (de `computeCephMeasurements`, H1 básico). */
export function computeDownsTweedMeasurements(base: CephMeasurements): DownsTweedMeasurements {
  if (base.FMA === null || base.IMPA === null) return { FMIA: null };
  return { FMIA: round1(180 - base.FMA - base.IMPA) };
}
