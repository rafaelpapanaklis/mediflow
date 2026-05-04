// Periodontics — Cairo 2018 (recesiones gingivales). SPEC §17 + §1.12.
//
// Reemplaza Miller 1985 por consenso World Workshop 2017. La clasificación
// compara la pérdida de inserción interproximal con la vestibular del mismo
// diente:
//   RT1 — sin pérdida interproximal (CAL_int = 0)
//   RT2 — pérdida interproximal ≤ vestibular (CAL_int > 0 && CAL_int ≤ CAL_vest)
//   RT3 — pérdida interproximal > vestibular (CAL_int > CAL_vest)

import type { CairoClassification } from "@prisma/client";

export type CairoInput = {
  /** Pérdida de inserción interproximal del diente, en mm (≥0). */
  calInterproximalMm: number;
  /** Pérdida de inserción vestibular (= altura recesión vestibular), en mm. */
  calVestibularMm: number;
};

/**
 * Devuelve RT1/RT2/RT3 según la regla Cairo 2018.
 * Acepta inputs no-negativos; valores negativos se clampean a 0 (sin pérdida).
 */
export function classifyCairo(input: CairoInput): CairoClassification {
  const calInt = Math.max(0, input.calInterproximalMm);
  const calVest = Math.max(0, input.calVestibularMm);

  if (calInt === 0) return "RT1";
  if (calInt <= calVest) return "RT2";
  return "RT3";
}

/**
 * Etiqueta humana de cada tipo Cairo, lista para tooltips/PDFs.
 */
export const CAIRO_LABELS: Record<CairoClassification, string> = {
  RT1: "RT1 — sin pérdida interproximal",
  RT2: "RT2 — pérdida interproximal ≤ vestibular",
  RT3: "RT3 — pérdida interproximal > vestibular",
};

/**
 * Pronóstico de cobertura radicular según Cairo (referencia para `Plan` y
 * comunicación con el paciente). RT1 ~100% predecible, RT3 limitado.
 */
export const CAIRO_PROGNOSIS: Record<CairoClassification, string> = {
  RT1: "Cobertura radicular completa altamente predecible.",
  RT2: "Cobertura radicular completa posible si las papilas se preservan.",
  RT3: "Cobertura radicular completa NO predecible; objetivo: recubrimiento parcial.",
};
