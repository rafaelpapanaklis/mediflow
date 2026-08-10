import "server-only";
import { prisma } from "@/lib/prisma";
import { computeCostUsdMicros, getPricingConfig } from "./pricing";
import type { RecordUsageNoChargeInput } from "./types";

/**
 * Registra el COSTO de una llamada a Claude que el plan de la clínica ya
 * incluye: mide, no cobra.
 *
 * Hasta hoy convivían dos contabilidades que no se hablaban — el contador de
 * tokens del plan (Clinic.aiTokensUsed) y el monedero prepago del bot
 * (AiWallet/AiUsageEvent) — y el consumo clínico solo movía el primero, así que
 * DaleControl le pagaba a Anthropic por cada análisis sin que la Tesorería
 * viera un peso. Esto cierra ese hueco por el lado del COSTO.
 *
 * Escribe UN AiUsageEvent con el costo real (micro-USD) y `billedCents: 0`.
 * Ese cero es la marca de "incluido en el plan": la Tesorería separa con él el
 * bloque prepago del absorbido para que el margen del prepago no se ensucie.
 *
 * NO toca AiWallet: no crea monedero, no descuenta saldo, no dispara recargas.
 *
 * Best-effort de arriba a abajo: cuando llegamos aquí la IA ya le respondió al
 * doctor, así que cualquier fallo se loguea y se traga. Llámalo SOLO después de
 * una llamada real y exitosa a Anthropic — en un cache hit no hubo costo y no
 * debe registrarse nada.
 */
export async function recordUsageNoCharge(input: RecordUsageNoChargeInput): Promise<void> {
  try {
    if (!input || !input.clinicId) return;

    const inputTokens = Math.max(0, Math.floor(input.inputTokens || 0));
    const outputTokens = Math.max(0, Math.floor(input.outputTokens || 0));
    const cacheReadTokens = Math.max(0, Math.floor(input.cacheTokens || 0));
    const cacheWriteTokens = Math.max(0, Math.floor(input.cacheWriteTokens || 0));
    // Sin tokens no hubo llamada facturable (mock, error o respuesta vacía).
    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) {
      return;
    }

    const cfg = await getPricingConfig();
    const costUsdMicros = computeCostUsdMicros(
      input.model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cfg,
      cacheWriteTokens,
    );

    await prisma.aiUsageEvent.create({
      data: {
        clinicId: input.clinicId,
        feature: input.feature,
        model: input.model,
        inputTokens,
        outputTokens,
        // La columna guarda el TOTAL de tokens de cache (lectura + escritura);
        // el reparto por precio ya quedó dentro de costUsdMicros.
        cacheTokens: cacheReadTokens + cacheWriteTokens,
        costUsdMicros,
        // fx y fee VIGENTES al momento del consumo: la Tesorería convierte a MXN
        // con el fx histórico de cada evento, igual que hace con el prepago.
        fxRate: cfg.usdToMxnRate,
        feePct: cfg.feePct,
        // 0 = incluido en el plan, no se le cobró nada a la clínica.
        billedCents: 0,
        threadId: null,
      },
    });
  } catch (err) {
    console.error("[ai-billing] costo de IA incluida en el plan no registrado (fail-open)", {
      clinicId: input?.clinicId,
      feature: input?.feature,
      err,
    });
  }
}
