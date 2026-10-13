// Eventos del píxel de TikTok en el NAVEGADOR (ws1-t5), con el mapeo de la
// plantilla de TikTok que pasó Rafael:
//   landing_vista → ViewContent · clic_empezar / whatsapp_clic → ClickButton
//   (content_name = origen) · registro_ok → CompleteRegistration · pago_ok →
//   Purchase. Lead NO se usa. content_type = «product», content_id = el plan.
// Los dos de servidor llevan event_id para que TikTok los deduplique contra la
// Events API (tiktok-capi.ts): `alta.<clinicId>` y `cs_…`.
//
// Solo en páginas de DaleControl (esPaginaDaleControl) y nunca en rutas
// privadas. ttq.identify con el correo en SHA-256 SOLO en registro y pago.
//
// Sin React: se prueba con `tsx --test` simulando `window`. Nunca lanza.
// Sin datos personales: Contact no lleva identificadores; los hashes viajan solo
// por el servidor.

import { esPaginaDaleControl, TIKTOK_PIXEL_ID, TIKTOK_SDK_URL } from "./tiktok-pixel";
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
 * Cola `ttq` del snippet oficial (arreglo con métodos que encolan; el SDK lo
 * drena al llegar). NO carga el SDK: así un evento que llega antes de que el
 * píxel cargue (landing_vista al montar, el SDK entra en ocioso ≤4 s) queda en
 * la cola en vez de perderse, y `arrancarTtq` la reutiliza sin duplicarla.
 */
function crearColaTtq(): any {
  const w = window as unknown as Record<string, any>;
  if (w.ttq) return w.ttq;
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
  return ttq;
}

/**
 * Carga el SDK sobre la cola (que puede traer eventos ya encolados). Idempotente:
 * el SDK se pide una sola vez y el page() inicial sale una sola vez.
 * `conPage`: mandar el page() inicial (solo rutas públicas).
 */
function arrancarTtq(conPage: boolean): boolean {
  const ttq = crearColaTtq();
  if (!ttq._i || !ttq._i[TIKTOK_PIXEL_ID]) ttq.load(TIKTOK_PIXEL_ID);
  if (conPage && !ttq._dcPage) {
    ttq._dcPage = true;
    ttq.page();
  }
  return true;
}

/** Arranque del píxel en rutas PÚBLICAS (lo llama <TiktokPixel />, ya en idle). true si queda disponible. */
export function cargarPixelTiktok(): boolean {
  try {
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    const ruta = window.location?.pathname ?? "";
    if (isPrivatePath(ruta) || !esPaginaDaleControl(ruta)) return false;
    return arrancarTtq(true);
  } catch {
    return false;
  }
}

function enviar(evento: string, props: Record<string, unknown>, eventId: string): boolean {
  try {
    if (typeof window === "undefined") return false;
    const ruta = window.location?.pathname ?? "";
    if (isPrivatePath(ruta) || !esPaginaDaleControl(ruta)) return false;
    // Sin ttq todavía (el SDK carga en ocioso): se crea la cola y el evento
    // espera en ella; arrancarTtq la reutiliza al cargar el SDK.
    if (!ttqDe()) crearColaTtq();
    const t = ttqDe();
    if (!t) return false;
    t.track!(evento, { content_type: "product", ...props }, { event_id: eventId });
    return true;
  } catch {
    return false;
  }
}

function conPlan(extra: Record<string, unknown>, plan?: string | null): Record<string, unknown> {
  return plan ? { ...extra, content_id: plan } : extra;
}

/** ViewContent al abrir la portada (landing_vista). */
export function trackTiktokViewContent(eventId: string): boolean {
  return enviar("ViewContent", { content_name: "portada" }, eventId);
}

/** ClickButton: clic_empezar y whatsapp_clic. `content_name` = origen del botón (lista cerrada). */
export function trackTiktokClickButton(origen: string, eventId: string, plan?: string | null): boolean {
  if (!/^[a-z_]{1,24}$/.test(origen)) return false;
  return enviar("ClickButton", conPlan({ content_name: origen }, plan), eventId);
}

/** SHA-256 hex del correo normalizado (minúsculas, sin espacios), con Web Crypto. null si no hay correo válido. */
export async function hashCorreoNavegador(correo: string | null | undefined): Promise<string | null> {
  try {
    const c = (correo ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return null;
    const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (!subtle) return null;
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(c));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** ttq.identify con el correo YA hasheado. Solo registro y pago; nunca el correo en claro. */
export function identificarTiktok(emailSha256: string | null | undefined): boolean {
  try {
    if (!emailSha256 || !/^[0-9a-f]{64}$/.test(emailSha256)) return false;
    const t = (typeof window === "undefined" ? null : (window as unknown as { ttq?: { identify?: (d: unknown) => void } }).ttq);
    if (!t || typeof t.identify !== "function") return false;
    t.identify({ email: emailSha256 });
    return true;
  } catch {
    return false;
  }
}

/**
 * CompleteRegistration desde /signup. Con correo: lo hashea, hace identify y
 * luego el evento (identify va ANTES). Sin correo o sin Web Crypto, el evento
 * sale igual. Devuelve true si el evento salió (síncrono cuando no hay correo).
 */
export function trackTiktokCompleteRegistration(
  eventId: string | null | undefined,
  opciones: { email?: string | null; plan?: string | null } = {},
): boolean {
  if (!eventId) return false;
  const props = conPlan({}, opciones.plan);
  if (!opciones.email) return enviar("CompleteRegistration", props, eventId);
  const salio = enviar("CompleteRegistration", props, eventId);
  // identify asíncrono (Web Crypto): el correo se hashea en el navegador y solo
  // el hash llega a ttq. Si la redirección lo corta, el servidor ya manda el
  // mismo evento con el correo hasheado.
  void hashCorreoNavegador(opciones.email).then((h) => identificarTiktok(h));
  return salio;
}

export interface CompraTiktokNavegador {
  /** id de la sesión de Checkout (cs_…): event_id del píxel y del servidor. */
  transactionId: string;
  /** Pesos SIN IVA con el cupón descontado. */
  valueMxn: number;
  currency: string;
  /** Plan contratado (content_id). */
  plan?: string | null;
  /** SHA-256 del correo del dentista (lo calcula el servidor de la página). */
  emailSha256?: string | null;
}

export function claveMarcaTiktok(transactionId: string): string {
  return `dc.tiktok.purchase.${transactionId}`;
}

export type ResultadoCompraTiktok = "enviada" | "ya-enviada" | "sin-ttq";

/** Purchase UNA vez por sesión de Stripe en este navegador (marca local). */
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
    identificarTiktok(compra.emailSha256);
    t.track!(
      "Purchase",
      conPlan(
        { content_type: "product", value: compra.valueMxn, currency: (compra.currency || "MXN").toUpperCase() },
        compra.plan,
      ),
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
