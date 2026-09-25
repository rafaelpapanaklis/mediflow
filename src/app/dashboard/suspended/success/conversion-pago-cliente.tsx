"use client";

// Conversión «Pago completado» (WS1-T3) — el lado del NAVEGADOR.
//
// No pinta nada. La página (servidor) solo lo monta cuando ya confirmó con
// Stripe que la sesión está pagada, es de esta clínica y es la primera
// contratación; aquí únicamente se dispara el gtag UNA vez:
//   · marca local por transaction_id (localStorage): al recargar no se reenvía;
//   · transaction_id = id de la sesión de Stripe: Google deduplica por él si la
//     marca local no existiera (otro navegador, modo privado);
//   · sin gtag (bloqueador, consentimiento) o sin etiqueta todavía, no pasa
//     nada y NO se marca: la página sigue igual y el próximo render lo intenta.
// localStorage puede lanzar (Safari privado, storage bloqueado): todo va en
// try/catch y sin marca simplemente confiamos en la deduplicación de Google.

import { useEffect } from "react";
import { trackPaymentCompletedConversion } from "@/lib/gtag";
import { claveMarcaLocal, type ConversionPagoCompletado } from "./conversion-pago";

export function ConversionPagoCompletadoGads({ transactionId, valueMxn, currency }: ConversionPagoCompletado) {
  useEffect(() => {
    const clave = claveMarcaLocal(transactionId);
    try {
      if (window.localStorage.getItem(clave)) return;
    } catch {
      // sin storage: seguimos; Google deduplica por transaction_id
    }
    const enviada = trackPaymentCompletedConversion({ transactionId, valueMxn, currency });
    if (!enviada) return;
    try {
      window.localStorage.setItem(clave, new Date().toISOString());
    } catch {
      // sin storage: ya salió una vez; la deduplicación queda en Google
    }
  }, [transactionId, valueMxn, currency]);

  return null;
}
