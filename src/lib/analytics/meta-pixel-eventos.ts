// Eventos del píxel de Meta en el NAVEGADOR (WS1-T4): CompleteRegistration y
// Purchase, cada uno con su eventID para que Meta lo deduplique contra el MISMO
// evento que manda la API de Conversiones desde el servidor (meta-capi.ts).
//
// Sin React: se prueba con `tsx --test` simulando `window`. Nunca lanza.

import { META_PIXEL_ID } from "./meta-pixel";

type FbqFn = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[][] };

function fbqDe(): FbqFn | null {
  if (typeof window === "undefined") return null;
  const fbq = (window as unknown as { fbq?: FbqFn }).fbq;
  return typeof fbq === "function" ? fbq : null;
}

/**
 * CompleteRegistration desde /signup (ruta pública: el layout ya hizo el init).
 * true si el evento salió (o quedó en la cola de fbq). Sin fbq (bloqueador) →
 * false y no pasa nada: el servidor lo manda igual con el mismo eventID.
 */
export function trackMetaCompleteRegistration(eventId: string | null | undefined): boolean {
  try {
    const fbq = fbqDe();
    if (!fbq || !eventId) return false;
    fbq("track", "CompleteRegistration", {}, { eventID: eventId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Arranca el píxel en UNA ruta del panel: /dashboard/suspended/success, y solo
 * cuando el servidor ya confirmó el primer pago. En el resto del panel el
 * layout no carga el píxel (rutas privadas) y esto no se llama.
 * `autoConfig` apagado: en el panel el píxel no rastrea clics ni lee la página
 * por su cuenta; solo sale el Purchase que mandamos nosotros.
 */
export function cargarPixelMetaEnPanel(): boolean {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    if (fbqDe()) return true;
    const w = window as unknown as { fbq?: FbqFn; _fbq?: FbqFn };
    // Mismo arranque que el snippet oficial del layout (cola hasta que llega fbevents.js).
    const n = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args);
      else n.queue!.push(args);
    } as FbqFn & { push?: unknown; loaded?: boolean; version?: string };
    w.fbq = n;
    if (!w._fbq) w._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
    n("set", "autoConfig", false, META_PIXEL_ID);
    n("init", META_PIXEL_ID);
    return true;
  } catch {
    return false;
  }
}

export interface CompraMetaNavegador {
  /** id de la sesión de Checkout (cs_…): eventID del píxel y event_id del servidor. */
  transactionId: string;
  /** Pesos SIN IVA con el cupón descontado (el mismo de «Pago completado»). */
  valueMxn: number;
  currency: string;
}

export function claveMarcaMeta(transactionId: string): string {
  return `dc.meta.purchase.${transactionId}`;
}

export type ResultadoCompraMeta = "enviada" | "ya-enviada" | "sin-fbq";

/** Purchase del píxel UNA vez por sesión de Stripe en este navegador (marca local). */
export function medirCompraMeta(compra: CompraMetaNavegador): ResultadoCompraMeta {
  const clave = claveMarcaMeta(compra.transactionId);
  try {
    if (window.localStorage.getItem(clave)) return "ya-enviada";
  } catch {
    // sin storage: Meta deduplica por eventID
  }
  if (!cargarPixelMetaEnPanel()) return "sin-fbq";
  const fbq = fbqDe();
  if (!fbq) return "sin-fbq";
  try {
    fbq(
      "track",
      "Purchase",
      { value: compra.valueMxn, currency: (compra.currency || "MXN").toUpperCase() },
      { eventID: compra.transactionId },
    );
  } catch {
    return "sin-fbq";
  }
  try {
    window.localStorage.setItem(clave, new Date().toISOString());
  } catch {
    // sin storage: ya salió una vez
  }
  return "enviada";
}
