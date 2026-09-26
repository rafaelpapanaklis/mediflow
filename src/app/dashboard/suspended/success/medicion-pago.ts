/**
 * Medición del pago completado en el NAVEGADOR (WS1-T6): la conversión de
 * Google Ads «Pago completado» y el `purchase` de GA4 salen JUNTOS, con el mismo
 * transaction_id (session_id de Stripe) y el mismo value (sin IVA), y con UNA
 * sola protección contra repetidos: la marca local por session_id.
 *
 * Sin React ni servidor: se prueba con `tsx --test` simulando `window`.
 * `conversion-pago-cliente.tsx` solo la llama desde un efecto (con reintento
 * mientras gtag.js aún no existe).
 */

import { trackPaymentCompletedConversion } from "@/lib/gtag";
import { trackGa4Purchase } from "@/lib/analytics/ga4";
import { claveMarcaLocal, type ConversionPagoCompletado } from "./conversion-pago";

/**
 *  · "enviada"   → salió al menos uno de los dos pings y quedó la marca local.
 *  · "ya-enviada" → había marca local para este session_id: no se manda nada.
 *  · "sin-gtag"  → gtag todavía no existe (o está bloqueado): no se marcó nada.
 */
export type ResultadoMedicionPago = "enviada" | "ya-enviada" | "sin-gtag";

export function medirPagoCompletado(conversion: ConversionPagoCompletado): ResultadoMedicionPago {
  const { transactionId, valueMxn, currency, plan } = conversion;
  const clave = claveMarcaLocal(transactionId);
  try {
    if (window.localStorage.getItem(clave)) return "ya-enviada";
  } catch {
    // sin storage: seguimos; Google deduplica por transaction_id
  }

  const ads = trackPaymentCompletedConversion({ transactionId, valueMxn, currency });
  const ga4 = trackGa4Purchase({
    transactionId,
    valueMxn,
    currency,
    ...(plan ? { item: { id: plan.id, name: plan.name, variant: plan.billing } } : {}),
  });
  if (!ads && !ga4) return "sin-gtag";

  try {
    window.localStorage.setItem(clave, new Date().toISOString());
  } catch {
    // sin storage: ya salió una vez; la deduplicación queda en Google y en GA4
  }
  return "enviada";
}

/** Reintento mientras gtag.js aún no está (afterInteractive va DESPUÉS de hidratar): 100 ms × 40 ≈ 4 s. */
export const REINTENTO_GTAG_MS = 100;
export const MAX_REINTENTOS_GTAG = 40;
