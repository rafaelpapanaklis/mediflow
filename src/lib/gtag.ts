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
