// Google Ads conversion tracking (cuenta AW-18276007996).
const GADS_SIGNUP_SEND_TO = "AW-18276007996/YXdlCM-xtMccELyA14pE";

type GtagFn = (...args: unknown[]) => void;

/**
 * Dispara la conversión "Registro completado" y luego navega a redirectUrl.
 * Usa event_callback para enviar el ping ANTES del redirect duro; si gtag no
 * está o el callback no llega, navega igual (timeout 800ms) para que el usuario
 * nunca se quede atorado.
 */
export function trackSignupConversionAndRedirect(redirectUrl: string): void {
  if (typeof window === "undefined") return;

  const go = () => { window.location.href = redirectUrl; };

  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  if (typeof gtag !== "function") { go(); return; }

  let navigated = false;
  const navigateOnce = () => { if (navigated) return; navigated = true; go(); };

  const timer = window.setTimeout(navigateOnce, 800);

  gtag("event", "conversion", {
    send_to: GADS_SIGNUP_SEND_TO,
    value: 1.0,
    currency: "MXN",
    event_callback: () => { window.clearTimeout(timer); navigateOnce(); },
  });
}

// ── Conversión «Pago completado» (WS1-T3) ──────────────────────────────────
//
// Segunda conversión de Google Ads: se dispara UNA vez por clínica, en
// /dashboard/suspended/success, solo cuando el servidor confirmó que la sesión
// de Stripe está pagada, es de la clínica de la sesión y es el PRIMER pago que
// saca a la cuenta de pending_payment (ver conversion-pago.ts junto a esa
// página). El importe es lo cobrado de verdad, en pesos, y transaction_id es
// el id de la sesión de Stripe: Google deduplica por ahí.
//
// ⚠️ LA ETIQUETA LA CREA RAFAEL en Google Ads → Objetivos → Conversiones →
// «+ Nueva acción de conversión» → Sitio web → categoría «Compra», nombre
// «Pago completado», valor «usar valores distintos», recuento «Una». Google
// le da la etiqueta (la parte DESPUÉS de "AW-18276007996/"); se pega aquí y
// el cambio es solo esta línea. Mientras esté vacía NO se envía nada a Google
// (ni con un send_to incompleto) y en desarrollo queda un console.info.
export const GADS_PAGO_COMPLETADO_LABEL = "";

const GADS_ACCOUNT_ID = "AW-18276007996";

export interface PaymentCompletedConversion {
  /** Id de la sesión de Checkout de Stripe (cs_…): Google deduplica por él. */
  transactionId: string;
  /** Importe realmente cobrado, en pesos (centavos de Stripe / 100). */
  valueMxn: number;
  /** ISO-4217 en mayúsculas; por defecto MXN. */
  currency?: string;
}

/**
 * Destino (`send_to`) de «Pago completado» para una etiqueta dada, o null si la
 * etiqueta está vacía: así nunca sale un "AW-18276007996/" a medias.
 */
export function paymentCompletedSendTo(label: string): string | null {
  const etiqueta = label.trim();
  return etiqueta ? `${GADS_ACCOUNT_ID}/${etiqueta}` : null;
}

/**
 * Dispara «Pago completado». Devuelve true SOLO si el ping salió de verdad:
 * false si falta la etiqueta, si no hay window o si gtag no está cargado
 * (bloqueador de anuncios, consentimiento). Nunca lanza y no navega: la página
 * de éxito funciona igual con o sin él.
 */
export function trackPaymentCompletedConversion(conversion: PaymentCompletedConversion): boolean {
  return sendPaymentCompletedConversion(GADS_PAGO_COMPLETADO_LABEL, conversion);
}

/** Núcleo con la etiqueta inyectada, para poder probarlo sin tocar la constante. */
export function sendPaymentCompletedConversion(
  label: string,
  conversion: PaymentCompletedConversion,
): boolean {
  if (typeof window === "undefined") return false;

  const sendTo = paymentCompletedSendTo(label);
  if (!sendTo) {
    if (process.env.NODE_ENV !== "production") {
      console.info(
        "[gtag] «Pago completado» NO enviado: falta GADS_PAGO_COMPLETADO_LABEL en src/lib/gtag.ts",
        conversion,
      );
    }
    return false;
  }

  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  if (typeof gtag !== "function") return false;

  gtag("event", "conversion", {
    send_to: sendTo,
    value: conversion.valueMxn,
    currency: conversion.currency ?? "MXN",
    transaction_id: conversion.transactionId,
  });
  return true;
}
