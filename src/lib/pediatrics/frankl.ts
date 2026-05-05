// Pediatrics — escalas de conducta Frankl/Venham + detección de regresión. Spec: §1.11, §4.A.1

export type FranklValue = 1 | 2 | 3 | 4;
export type VenhamValue = 0 | 1 | 2 | 3 | 4 | 5;

export const FRANKL_LABELS: Record<FranklValue, string> = {
  1: "Definitivamente negativo",
  2: "Negativo",
  3: "Positivo",
  4: "Definitivamente positivo",
};

export const FRANKL_SHORT_LABELS: Record<FranklValue, string> = {
  1: "Def. negativo",
  2: "Negativo",
  3: "Positivo",
  4: "Def. positivo",
};

export const VENHAM_LABELS: Record<VenhamValue, string> = {
  0: "Relajado, sonriente",
  1: "Incómodo, preocupado",
  2: "Tenso",
  3: "Renuente, llanto leve",
  4: "Resistencia activa",
  5: "Fuera de contacto, llanto intenso",
};

export function isFranklValue(v: number): v is FranklValue {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

export function isVenhamValue(v: number): v is VenhamValue {
  return v >= 0 && v <= 5 && Number.isInteger(v);
}

export type RegressionResult = {
  detected: boolean;
  severity: "none" | "mild" | "severe";
  delta: number;
};

/**
 * Detecta regresión comparando el último Frankl con el promedio de los
 * dos previos. Una baja de ≥1 punto = mild; ≥2 puntos = severe. Ignora
 * el caso de la primera visita (no hay con qué comparar).
 */
export function detectRegression(
  history: { value: number; date: Date }[],
): RegressionResult {
  if (history.length < 2) return { detected: false, severity: "none", delta: 0 };

  const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = sorted[sorted.length - 1]!;
  const previous = sorted.slice(-3, -1);
  if (previous.length === 0) return { detected: false, severity: "none", delta: 0 };

  const prevAvg = previous.reduce((sum, h) => sum + h.value, 0) / previous.length;
  const delta = latest.value - prevAvg;

  if (delta <= -2) return { detected: true, severity: "severe", delta };
  if (delta <= -1) return { detected: true, severity: "mild", delta };
  return { detected: false, severity: "none", delta };
}
