// Implants — criterios de éxito Albrektsson 1986 (modificado ITI). Spec §17.
// Año 1: pérdida ósea aceptada hasta 1.5 mm.
// Tras año 1: <0.2 mm/año.
// Sin movilidad clínica, dolor, parestesia, sangrado a presión sostenida,
// radiolucidez (criterios cualitativos, no calculables aquí).

export type AlbrektssonResult = {
  meetsCriteria: boolean;
  expectedMaxBoneLossMm: number;
  observedBoneLossMm: number;
  yearsSincePlacement: number;
};

/**
 * Pérdida ósea radiográfica esperada (límite superior aceptado) según
 * los años transcurridos desde la colocación.
 */
export function expectedMaxBoneLossMm(yearsSincePlacement: number): number {
  if (yearsSincePlacement <= 0) return 0;
  if (yearsSincePlacement <= 1) return 1.5;
  return 1.5 + (yearsSincePlacement - 1) * 0.2;
}

/**
 * Evalúa si la pérdida ósea radiográfica observada cumple Albrektsson
 * para los años transcurridos desde colocación. Si la pérdida observada
 * es <= expectedMax, cumple criterios.
 */
export function evaluateAlbrektsson(
  observedBoneLossMm: number,
  yearsSincePlacement: number,
): AlbrektssonResult {
  const expected = expectedMaxBoneLossMm(yearsSincePlacement);
  return {
    meetsCriteria: observedBoneLossMm <= expected,
    expectedMaxBoneLossMm: expected,
    observedBoneLossMm,
    yearsSincePlacement,
  };
}

/** Calcula años decimales entre dos fechas (placedAt → followUpDate). */
export function yearsBetween(placedAt: Date, followUpDate: Date): number {
  const ms = followUpDate.getTime() - placedAt.getTime();
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}
