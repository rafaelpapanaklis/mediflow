// Conversión «Pago completado» (WS1-T3) — el lado del SERVIDOR.
//
// Trae la sesión de Checkout desde Stripe (server-to-server, con la clave
// secreta) y deja que el núcleo puro (conversion-pago.ts) decida. Nunca lanza:
// si Stripe no está configurado, no responde o la sesión no existe, devuelve
// null y la página de éxito se pinta igual que hoy. Solo se llama cuando la
// clínica YA está activada en la BD y la URL trae un session_id con forma
// válida, así que a Stripe se va como mucho una vez por render de la cara
// «¡Pago confirmado!», no en cada vuelta del <ConfirmingPoll/>.
//
// Sin `import "server-only"` a propósito: este archivo solo lo importa el
// server component page.tsx y el shim de server-only rompe las suites de tsx.

import { getStripeSafe } from "@/lib/stripe";
import {
  decidirConversionPago,
  esSessionIdValido,
  type ConversionPagoCompletado,
} from "./conversion-pago";

export async function conversionPagoConfirmada(input: {
  clinicId: string;
  sessionId: string | null | undefined;
  activada: boolean;
}): Promise<ConversionPagoCompletado | null> {
  const { clinicId, sessionId, activada } = input;
  if (!activada || !clinicId || !esSessionIdValido(sessionId)) return null;

  const stripe = getStripeSafe();
  if (!stripe) return null;

  try {
    const sesion = await stripe.checkout.sessions.retrieve(sessionId);
    return decidirConversionPago({ clinicId, sessionId, activada, sesion });
  } catch (err) {
    // Sesión inexistente (id inventado), red caída, clave rota… medir nunca
    // puede tumbar la pantalla que le dice al cliente que ya pagó.
    console.warn("[gads] no se pudo confirmar la sesión de Stripe para la conversión:", (err as Error)?.message ?? err);
    return null;
  }
}
