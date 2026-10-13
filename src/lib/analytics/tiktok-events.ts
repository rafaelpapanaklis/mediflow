// Eventos del píxel de TikTok en el NAVEGADOR (ws1-t5): Contact (clic en
// WhatsApp), CompleteRegistration y CompletePayment, cada uno con su event_id
// para que TikTok lo deduplique contra la Events API del servidor
// (tiktok-capi.ts). Mismos ids que Meta: `alta.<clinicId>`, `cs_…`, `wa.<origen>.…`.
//
// Sin React: se prueba con `tsx --test` simulando `window`. Nunca lanza.
// Sin datos personales: Contact no lleva identificadores; los hashes viajan solo
// por el servidor.

import { TIKTOK_PIXEL_ID, TIKTOK_SDK_URL } from "./tiktok-pixel";
import { isPrivatePath } from "./ga4";

type TtqObj = { track?: (evento: string, props?: unknown, opts?: unknown) => void };

function ttqDe(): TtqObj | null {
  if (typeof window === "undefined") return null;
  const t = (window as unknown as { ttq?: TtqObj }).ttq;
  return t && typeof t.track === "function" ? t : null;
}

/** ¿Ya hay un ttq con cola (aunque el SDK aún no haya llegado)? */
function hayTtq(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as { ttq?: unknown }).ttq;
}

const METODOS_TTQ = [
  "page", "track", "identify", "instances", "debug", "on", "off", "once", "ready",
  "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent",
];

/**
 * Arranque FIEL del snippet oficial de TikTok (ttq es un arreglo con métodos
 * que encolan; el SDK lo drena al llegar), pero cargado a demanda y fuera del
 * layout. `conPage`: mandar el page() inicial (solo rutas públicas).
 */
function arrancarTtq(conPage: boolean): boolean {
  const w = window as unknown as Record<string, unknown>;
  if (hayTtq()) return true;
  w.TiktokAnalyticsObject = "ttq";
  const ttq: any = (w.ttq = []);
  ttq.methods = METODOS_TTQ;
  ttq.setAndDefer = (t: any, e: string) => {
    t[e] = (...args: unknown[]) => { t.push([e, ...args]); };
  };
  for (const m of METODOS_TTQ) ttq.setAndDefer(ttq, m);
  ttq.instance = (id: string) => {
    const e = ttq._i[id] || [];
    for (const m of METODOS_TTQ) ttq.setAndDefer(e, m);
    return e;
  };
  ttq.load = (id: string, opciones?: unknown) => {
    ttq._i = ttq._i || {};
    ttq._i[id] = [];
    ttq._i[id]._u = TIKTOK_SDK_URL;
    ttq._t = ttq._t || {};
    ttq._t[id] = +new Date();
    ttq._o = ttq._o || {};
    ttq._o[id] = opciones || {};
    const s = document.createElement("script");
    s.async = true;
    s.src = `${TIKTOK_SDK_URL}?sdkid=${encodeURIComponent(id)}&lib=ttq`;
    document.head.appendChild(s);
  };
  ttq.load(TIKTOK_PIXEL_ID);
  if (conPage) ttq.page();
  return true;
}

/** Arranque del píxel en rutas PÚBLICAS (lo llama <TiktokPixel />, ya en idle). true si queda disponible. */
export function cargarPixelTiktok(): boolean {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    if (isPrivatePath(window.location?.pathname ?? "")) return false;
    return arrancarTtq(true);
  } catch {
    return false;
  }
}

function enviar(evento: string, props: Record<string, unknown>, eventId: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (isPrivatePath(window.location?.pathname ?? "")) return false;
    const t = ttqDe();
    if (!t) return false;
    t.track!(evento, props, { event_id: eventId });
    return true;
  } catch {
    return false;
  }
}

/** Contact por un clic en WhatsApp. Mismo event_id que el Lead de Meta (único por clic). Solo rutas públicas. */
export function trackTiktokContactWhatsapp(origen: string, eventId: string): boolean {
  return enviar("Contact", { content_name: `whatsapp_${origen}` }, eventId);
}

/** CompleteRegistration desde /signup (ruta pública). Sin ttq (bloqueador) → false; el servidor lo manda igual. */
export function trackTiktokCompleteRegistration(eventId: string | null | undefined): boolean {
  if (!eventId) return false;
  return enviar("CompleteRegistration", {}, eventId);
}

export interface CompraTiktokNavegador {
  /** id de la sesión de Checkout (cs_…): event_id del píxel y del servidor. */
  transactionId: string;
  /** Pesos SIN IVA con el cupón descontado. */
  valueMxn: number;
  currency: string;
}

export function claveMarcaTiktok(transactionId: string): string {
  return `dc.tiktok.payment.${transactionId}`;
}

export type ResultadoCompraTiktok = "enviada" | "ya-enviada" | "sin-ttq";

/** CompletePayment UNA vez por sesión de Stripe en este navegador (marca local). */
export function medirCompraTiktok(compra: CompraTiktokNavegador): ResultadoCompraTiktok {
  const clave = claveMarcaTiktok(compra.transactionId);
  try {
    if (window.localStorage.getItem(clave)) return "ya-enviada";
  } catch {
    // sin storage: TikTok deduplica por event_id
  }
  // /dashboard/suspended/success es ruta privada: el layout no cargó el píxel.
  // Se arranca aquí SOLO para este evento (sin page(): nada más se mide).
  if (!ttqDe() && !cargarEnPanel()) return "sin-ttq";
  try {
    const t = ttqDe();
    if (!t) return "sin-ttq";
    t.track!(
      "CompletePayment",
      { value: compra.valueMxn, currency: (compra.currency || "MXN").toUpperCase() },
      { event_id: compra.transactionId },
    );
  } catch {
    return "sin-ttq";
  }
  try {
    window.localStorage.setItem(clave, new Date().toISOString());
  } catch {
    // ya salió una vez
  }
  return "enviada";
}

/** Arranque del píxel en la ÚNICA ruta privada que mide: la página de éxito del primer pago (sin page()). */
function cargarEnPanel(): boolean {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    return arrancarTtq(false);
  } catch {
    return false;
  }
}
