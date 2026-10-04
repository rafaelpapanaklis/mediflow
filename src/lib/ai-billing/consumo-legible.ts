// N-57 (ws1-t8, segunda auditoría de uso): en Saldo IA el costo de cada fila
// no guardaba relación visible con los tokens (de ~$0.04 a ~$1.35 por mil) y
// la tabla no decía por qué. Las razones son reales y ya se cobran bien: el
// modelo (rápido / estándar / avanzado, de precios distintos), que ESCRIBIR
// cuesta 5 veces más que LEER, y el contexto que se relee (caché). Aquí, puro,
// cómo se le enseña eso a la clínica, sin nombres de modelo crudos.

import { normalizeModelId } from "./pricing-core";
import type { ModelPrice } from "./types";

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

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * N-57 (ronda final): `cacheTokens` guarda JUNTOS el contexto que se GUARDÓ en
 * memoria esa vez (cuesta 1.25× la entrada) y el que se RELEYÓ (0.1×): 12.5
 * veces de diferencia. Por eso dos filas con los mismos tokens costaban $0.05 y
 * $0.11. El costo real (`costUsdMicros`) sí llevaba el reparto; aquí se
 * reconstruye con el precio del modelo con el que se cobró:
 *   costo = in·pIn + out·pOut + leído·pRead + guardado·pWrite,  leído + guardado = cache
 *   ⇒ guardado = (costo − in·pIn − out·pOut − cache·pRead) / (pWrite − pRead)
 * Acotado a [0, cache] por el redondeo a micro-USD.
 */
export function separarCache(u: FilaConsumo & { costUsdMicros?: number | null }, precio: ModelPrice): { guardado: number; releido: number } {
  const cache = n(u.cacheTokens);
  const dif = precio.cacheWriteUsdPerMtok - precio.cacheReadUsdPerMtok;
  if (cache === 0 || !(dif > 0) || typeof u.costUsdMicros !== "number") return { guardado: 0, releido: cache };
  const resto = u.costUsdMicros - n(u.inputTokens) * precio.inputUsdPerMtok - n(u.outputTokens) * precio.outputUsdPerMtok - cache * precio.cacheReadUsdPerMtok;
  const guardado = Math.min(cache, Math.max(0, Math.round(resto / dif)));
  return { guardado, releido: cache - guardado };
}

/**
 * Las tres cosas que se cobran distinto: lo que la IA LEYÓ (pregunta + contexto
 * releído, barato), lo que GUARDÓ en memoria por primera vez (caro) y lo que
 * ESCRIBIÓ (lo más caro). Sin el reparto (filas viejas), todo el contexto cuenta
 * como leído.
 */
export function desgloseConsumo(u: FilaConsumo & { cacheGuardado?: number | null }): { leidos: number; guardados: number; escritos: number; total: number } {
  const cache = n(u.cacheTokens);
  const guardados = Math.min(cache, n(u.cacheGuardado));
  const leidos = n(u.inputTokens) + cache - guardados;
  const escritos = n(u.outputTokens);
  return { leidos, guardados, escritos, total: leidos + guardados + escritos };
}

export const NOTA_COSTO_CONSUMO = {
  es: "Cada consulta se cobra según el modelo y el tipo de trabajo: releer lo ya guardado es casi gratis; leer la pregunta cuesta poco; guardar el contexto en memoria la primera vez cuesta unas 12 veces más que releerlo, y escribir la respuesta es lo más caro. Por eso dos consultas parecidas pueden costar distinto.",
  en: "Each request is charged by model and kind of work: re-reading what's already stored is almost free; reading the question costs little; storing the context the first time costs about 12 times more than re-reading it, and writing the answer costs the most. That's why two similar requests can cost differently.",
} as const;
