// N-57 (ws1-t8, segunda auditoría de uso): en Saldo IA el costo de cada fila
// no guardaba relación visible con los tokens (de ~$0.04 a ~$1.35 por mil) y
// la tabla no decía por qué. Las razones son reales y ya se cobran bien: el
// modelo (rápido / estándar / avanzado, de precios distintos), que ESCRIBIR
// cuesta 5 veces más que LEER, y el contexto que se relee (caché). Aquí, puro,
// cómo se le enseña eso a la clínica, sin nombres de modelo crudos.

import { normalizeModelId } from "./pricing-core";

export interface FilaConsumo {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens?: number | null;
}

/** El modelo dicho para la clínica. */
export function modeloLegible(model: string, locale: string = "es"): string {
  const id = normalizeModelId(model);
  const en = locale.startsWith("en");
  if (id.includes("haiku")) return en ? "fast model" : "modelo rápido";
  if (id.includes("opus") || id.includes("fable")) return en ? "advanced model" : "modelo avanzado";
  if (id.includes("sonnet")) return en ? "standard model" : "modelo estándar";
  return en ? "model" : "modelo";
}

/** Lo que la IA leyó (pregunta + contexto, incluido el releído) y lo que escribió. */
export function desgloseConsumo(u: FilaConsumo): { leidos: number; escritos: number; total: number } {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const leidos = n(u.inputTokens) + n(u.cacheTokens);
  const escritos = n(u.outputTokens);
  return { leidos, escritos, total: leidos + escritos };
}

export const NOTA_COSTO_CONSUMO = {
  es: "El costo de cada consulta depende del modelo que respondió y de cuánto escribió: escribir cuesta unas 5 veces más que leer.",
  en: "Each request's cost depends on the model that answered and how much it wrote: writing costs about 5 times more than reading.",
} as const;
