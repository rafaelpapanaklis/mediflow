import "server-only";
import { prisma } from "@/lib/prisma";
import type { PricingConfig } from "./types";

/**
 * Precios de IA (globales, fila id="default" de AiPricingConfig) + conversión
 * del costo real de Anthropic (micro-USD) a centavos MXN cobrados a la clínica.
 *
 *   billedCents = round(costUsd * usdToMxnRate * (1 + feePct/100) * 100)
 *
 * El fee va OCULTO dentro de billedCents: la clínica nunca ve USD ni el %.
 */

/** Defaults = mismos @default del schema; sirven si aún no existe la fila. */
const DEFAULT_PRICING: PricingConfig = {
  inputUsdPerMtok: 3,
  outputUsdPerMtok: 15,
  cacheWriteUsdPerMtok: 3.75,
  cacheReadUsdPerMtok: 0.3,
  usdToMxnRate: 19.5,
  feePct: 8,
};

// Cache en memoria: la config cambia rara vez y el proceso serverless es de
// vida corta. TTL chico para que un cambio del admin se refleje pronto.
let cached: { value: PricingConfig; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

/** Lee la config de precios (cacheada). Nunca lanza: cae a DEFAULT_PRICING. */
export async function getPricingConfig(): Promise<PricingConfig> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const row = await prisma.aiPricingConfig.findUnique({ where: { id: "default" } });
    const value: PricingConfig = row
      ? {
          inputUsdPerMtok: row.inputUsdPerMtok,
          outputUsdPerMtok: row.outputUsdPerMtok,
          cacheWriteUsdPerMtok: row.cacheWriteUsdPerMtok,
          cacheReadUsdPerMtok: row.cacheReadUsdPerMtok,
          usdToMxnRate: row.usdToMxnRate,
          feePct: row.feePct,
        }
      : DEFAULT_PRICING;
    cached = { value, at: now };
    return value;
  } catch {
    return cached?.value ?? DEFAULT_PRICING;
  }
}

/** Invalida la cache (útil tras un update del admin). */
export function clearPricingCache(): void {
  cached = null;
}

/**
 * Costo real de Anthropic en MICRO-USD (entero) para una llamada.
 * usdPerMtok = USD por millón de tokens ⇒ tokens * usdPerMtok = micro-USD
 * (porque tokens/1e6 * usdPerMtok = USD, y USD * 1e6 = micro-USD).
 *
 * `cacheTokens` se cobra al precio de LECTURA (cache_read); el bot no usa cache
 * hoy, así que en la práctica suele ser 0. `cacheWriteTokens` es opcional y
 * pertenece a las rutas clínicas, que sí mandan `cache_control: ephemeral`:
 * escribir cache cuesta ~12x leerlo (3.75 vs 0.30 USD/Mtok), así que meterlo en
 * el mismo saco subestimaría el costo real ~25% en un análisis con cache frío.
 * Los llamadores viejos (chargeUsage) no lo pasan y se comportan igual que antes.
 *
 * `model` queda reservado para precios por-modelo en el futuro (hoy hay un
 * precio único, así que Haiku se cobra al precio de Sonnet: sobreestima, nunca
 * subestima el cheque a Anthropic).
 */
export function computeCostUsdMicros(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheTokens: number,
  cfg: PricingConfig,
  cacheWriteTokens = 0,
): number {
  const micros =
    inputTokens * cfg.inputUsdPerMtok +
    outputTokens * cfg.outputUsdPerMtok +
    cacheTokens * cfg.cacheReadUsdPerMtok +
    cacheWriteTokens * cfg.cacheWriteUsdPerMtok;
  return Math.max(0, Math.round(micros));
}

/** Convierte costo (micro-USD) a centavos MXN cobrados, fee OCULTO incluido. */
export function usdMicrosToBilledCents(costUsdMicros: number, cfg: PricingConfig): number {
  const costUsd = costUsdMicros / 1_000_000;
  const mxn = costUsd * cfg.usdToMxnRate * (1 + cfg.feePct / 100);
  return Math.max(0, Math.round(mxn * 100));
}
