// Conversión secundaria «Clic en WhatsApp» de Google Ads (ws1-t5). La etiqueta y
// el destino viven en @/lib/gtag; aquí solo el disparo, que no sale en rutas
// privadas (isPrivatePath). Sin datos personales. Nunca lanza ni navega.

import { GADS_WHATSAPP_CLIC_LABEL, whatsappClickSendTo } from "@/lib/gtag";
import { isPrivatePath } from "./ga4";
import { trackMetaLeadWhatsapp, type OrigenLeadWhatsapp } from "./meta-pixel-eventos";

type GtagFn = (...args: unknown[]) => void;

/** true SOLO si el ping salió (etiqueta puesta, ruta pública y gtag cargado). */
export function trackWhatsappClickConversion(label: string = GADS_WHATSAPP_CLIC_LABEL): boolean {
  try {
    if (typeof window === "undefined") return false;
    const sendTo = whatsappClickSendTo(label);
    if (!sendTo) return false;
    if (isPrivatePath(window.location?.pathname ?? "")) return false;
    const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
    if (typeof gtag !== "function") return false;
    gtag("event", "conversion", { send_to: sendTo });
    return true;
  } catch {
    return false;
  }
}

/**
 * UNA llamada por clic en un botón de WhatsApp para el embudo (la usa
 * registrarPaso de embudo.ts): Lead del píxel de Meta + conversión secundaria
 * de Google Ads. Devuelve qué salió, para pruebas y diagnóstico. GA4
 * (whatsapp_clic) lo manda embudo.ts aparte.
 */
export function medirClicWhatsapp(origen: OrigenLeadWhatsapp): { metaEventId: string | null; ads: boolean } {
  return { metaEventId: trackMetaLeadWhatsapp(origen), ads: trackWhatsappClickConversion() };
}
