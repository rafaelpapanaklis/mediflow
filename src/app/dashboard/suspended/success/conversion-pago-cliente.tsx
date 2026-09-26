"use client";

// Conversión «Pago completado» (WS1-T3) + `purchase` de GA4 (WS1-T6) — el lado del NAVEGADOR.
//
// No pinta nada. La página (servidor) solo lo monta cuando ya confirmó con
// Stripe que la sesión está pagada, es de esta clínica y es la primera
// contratación; aquí únicamente se dispara el gtag UNA vez:
//   · marca local por transaction_id (localStorage): al recargar no se reenvía;
//   · transaction_id = id de la sesión de Stripe: Google deduplica por él si la
//     marca local no existiera (otro navegador, modo privado);
//   · gtag.js llega DESPUÉS de hidratar (afterInteractive): si aún no existe se
//     reintenta cada 100 ms hasta ~4 s, como ga-pageview.tsx. Sin gtag
//     (bloqueador) no pasa nada y NO se marca: la página sigue igual.
// localStorage puede lanzar (Safari privado, storage bloqueado): todo va en
// try/catch y sin marca simplemente confiamos en la deduplicación de Google.

import { useEffect } from "react";
import type { ConversionPagoCompletado } from "./conversion-pago";
import { MAX_REINTENTOS_GTAG, medirPagoCompletado, REINTENTO_GTAG_MS } from "./medicion-pago";

export function ConversionPagoCompletadoGads(conversion: ConversionPagoCompletado) {
  const { transactionId, valueMxn, currency, plan } = conversion;

  useEffect(() => {
    let timer: number | undefined;
    let intentos = 0;

    const intentar = () => {
      const resultado = medirPagoCompletado({ transactionId, valueMxn, currency, plan });
      if (resultado !== "sin-gtag") return;
      if (intentos++ >= MAX_REINTENTOS_GTAG) return; // gtag bloqueado → se deja pasar
      timer = window.setTimeout(intentar, REINTENTO_GTAG_MS);
    };

    intentar();
    return () => window.clearTimeout(timer);
    // Si `plan` cambia de identidad (router.refresh) el efecto repite, pero la
    // marca local ya impide el segundo envío.
  }, [transactionId, valueMxn, currency, plan]);

  return null;
}
