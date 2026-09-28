// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Agregador: junta
// H1 básico (`measurements.ts`, sin tocar) con las 4 familias de medidas
// nuevas (Steiner extra, Ricketts, McNamara, Downs/Tweed) en un solo
// objeto. Puro — sin Prisma, sin React.
//
// `computeCephMeasurements` (H1 básico) SIGUE siendo la función que llama
// `saveCephalometricAnalysis.ts` hoy — no se toca su forma ni su nombre.
// `computeFullCephAnalysis` es la nueva, superconjunto, para cuando la
// Parte B integre el trazado completo. Un trazado viejo de 10 puntos le
// entra igual: las medidas nuevas salen todas en `null` porque los puntos
// que necesitan no están — ver `__tests__/backward-compat.test.ts`.

import { computeCephMeasurements, type CephMeasurements } from "./measurements";
import type { CephPoints } from "./landmarks";
import { computeSteinerExtras, type SteinerExtraMeasurements } from "./analyses/steiner";
import { computeRickettsMeasurements, type RickettsMeasurements } from "./analyses/ricketts";
import { computeMcNamaraMeasurements, type McNamaraMeasurements } from "./analyses/mcnamara";
import { computeDownsTweedMeasurements, type DownsTweedMeasurements } from "./analyses/downs-tweed";

export type FullCephMeasurements = CephMeasurements &
  SteinerExtraMeasurements &
  RickettsMeasurements &
  McNamaraMeasurements &
  DownsTweedMeasurements;

/**
 * `pixelsPerMm`: px por 1mm (ver nota de nombre engañoso en
 * `calibration.ts`). Sin calibrar, todas las medidas angulares se
 * calculan igual y todas las lineales (mm) salen `null`.
 */
export function computeFullCephAnalysis(
  points: CephPoints,
  pixelsPerMm?: number | null,
): FullCephMeasurements {
  const base = computeCephMeasurements(points);
  return {
    ...base,
    ...computeSteinerExtras(points, pixelsPerMm),
    ...computeRickettsMeasurements(points, pixelsPerMm),
    ...computeMcNamaraMeasurements(points, pixelsPerMm),
    ...computeDownsTweedMeasurements(base),
  };
}
