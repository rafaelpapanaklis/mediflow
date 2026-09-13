import "server-only";
import { prisma } from "@/lib/prisma";
import type { PricingConfig } from "./types";
import { DEFAULT_PRICING_ROW_ID, MODEL_PRICING_ROW_PREFIX, pricingConfigFromRows } from "./pricing-core";

/**
 * Precios de IA + conversión del costo real de Anthropic (micro-USD) a centavos
 * MXN cobrados a la clínica. La aritmética vive en `pricing-core.ts` (puro,
 * probado); aquí solo se lee la base y se cachea.
 *
 *   billedCents = round(costUsd * usdToMxnRate * (1 + feePct/100) * 100)
 *
 * costUsd sale del precio DEL MODELO que se usó. Fx y fee: fila id="default" de
 * AiPricingConfig. Precio por modelo editado en el admin: filas id="model:<id>".
 * El fee va OCULTO dentro de billedCents: la clínica nunca ve USD ni el %.
 */

export {
  computeCostUsdMicros,
  usdMicrosToBilledCents,
  modelPriceRows,
  type ModelPriceRow,
} from "./pricing-core";

// Cache en memoria: la config cambia rara vez y el proceso serverless es de
// vida corta. TTL chico para que un cambio del admin se refleje pronto.
let cached: { value: PricingConfig; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

/** Lee la config de precios (cacheada). Nunca lanza: cae a los precios de lista. */
export async function getPricingConfig(): Promise<PricingConfig> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const rows = await prisma.aiPricingConfig.findMany({
      where: { OR: [{ id: DEFAULT_PRICING_ROW_ID }, { id: { startsWith: MODEL_PRICING_ROW_PREFIX } }] },
    });
    const value = pricingConfigFromRows(rows);
    cached = { value, at: now };
    return value;
  } catch {
    return cached?.value ?? pricingConfigFromRows([]);
  }
}

/** Invalida la cache (útil tras un update del admin). */
export function clearPricingCache(): void {
  cached = null;
}
