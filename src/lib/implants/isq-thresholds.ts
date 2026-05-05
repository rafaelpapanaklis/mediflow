// Implants — umbrales ISQ (consenso ITI). Spec §1.14, §17.
//   ≥70 (ambos MD y VL) → apto para carga
//   60–69            → zona límite, cicatrizar 4 sem más
//   <60              → NO cargar, riesgo de pérdida

export type IsqZone = "ready" | "borderline" | "unsafe";

export type IsqEvaluation = {
  canLoad: boolean;
  zone: IsqZone;
  isqMin: number;
  reason: string;
};

/**
 * Decide si el implante es apto para carga según ISQ mesiodistal +
 * vestibulolingual. La regla del consenso ITI exige que AMBAS
 * mediciones estén ≥70 — basta con que la mínima caiga abajo para
 * descartar la carga.
 */
export function evaluateIsqForLoading(
  isqMesiodistal: number,
  isqVestibulolingual: number,
): IsqEvaluation {
  const minIsq = Math.min(isqMesiodistal, isqVestibulolingual);

  if (minIsq < 60) {
    return {
      canLoad: false,
      zone: "unsafe",
      isqMin: minIsq,
      reason: `ISQ ${minIsq} < 60 — NO cargar, riesgo de pérdida.`,
    };
  }

  if (minIsq < 70) {
    return {
      canLoad: false,
      zone: "borderline",
      isqMin: minIsq,
      reason: `ISQ ${minIsq} en zona límite (60–69) — cicatrizar 4 semanas más.`,
    };
  }

  return {
    canLoad: true,
    zone: "ready",
    isqMin: minIsq,
    reason: `ISQ ${minIsq} ≥ 70 — apto para carga.`,
  };
}
