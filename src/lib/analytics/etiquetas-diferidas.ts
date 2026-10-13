import { GA4_MEASUREMENT_ID, PRIVATE_PATH_PATTERN } from "./ga4";
import { META_PIXEL_ID } from "./meta-pixel";

/**
 * Etiquetas de terceros DIFERIDAS (12-oct-2026, ws1-t4, punto 3a del encargo de
 * ws7: «LiveChat, GA4, píxeles y tag de Google deben cargar después de lo
 * principal»). Es el JS inline del layout raíz, aquí para poder probarlo.
 *
 * Qué cambia respecto a cargar gtag.js y fbevents.js con `afterInteractive`:
 *
 * · Los STUBS se definen en seguida, igual que antes: `window.gtag` encola en
 *   `dataLayer` y `window.fbq` encola en `fbq.queue` (es el arranque oficial de
 *   Meta, que ya funciona así). <GaPageview/>, <MetaPixelPageview/> y los
 *   eventos de @/lib/analytics y @/lib/gtag ven `typeof gtag === "function"` y
 *   siguen funcionando sin tocarlos; nada se pierde: cuando el script real
 *   llega, vacía la cola (gtag.js lee dataLayer; fbevents.js lee fbq.queue).
 * · Lo que se retrasa es la RED: gtag.js (~100 KB) y fbevents.js (~90 KB) se
 *   piden cuando el navegador queda ocioso tras `load` (requestIdleCallback con
 *   tope de 4 s) o al primer gesto del usuario, lo que llegue antes. Así no
 *   compiten con el HTML, el CSS y la imagen del hero en el celular.
 * · `window.__dcDiferir(fn)` queda disponible para otras etiquetas (TikTok de
 *   ws1-t5 trae su propio «idle o 4 s»; puede usar este si quiere).
 *
 * Mismo guard de rutas privadas que antes: en el panel, /paciente y /portal no
 * se configura GA4 ni se define fbq (Ads sí: mide conversiones en todas).
 */
export const GOOGLE_ADS_ID = "AW-18276007996";
export const URL_GTAG = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
export const URL_FBEVENTS = "https://connect.facebook.net/en_US/fbevents.js";
/** Tope del requestIdleCallback: si el hilo nunca queda libre, se cargan igual. */
export const TOPE_OCIOSO_MS = 4000;

export function scriptEtiquetasDiferidas(): string {
  return `
(function(w,d){
  var privada = new RegExp(${JSON.stringify(PRIVATE_PATH_PATTERN)}).test(location.pathname);
  var pendientes = [], disparado = false;
  function correr(){ if (disparado) return; disparado = true; var fs = pendientes; pendientes = []; fs.forEach(function(f){ try { f(); } catch(e){} }); }
  function cuandoOcioso(){ if (w.requestIdleCallback) w.requestIdleCallback(correr, { timeout: ${TOPE_OCIOSO_MS} }); else setTimeout(correr, 1500); }
  if (d.readyState === "complete") cuandoOcioso(); else w.addEventListener("load", cuandoOcioso, { once: true });
  ["pointerdown","keydown","touchstart","scroll"].forEach(function(ev){ w.addEventListener(ev, correr, { once: true, passive: true }); });
  w.__dcDiferir = function(f){ if (disparado) { try { f(); } catch(e){} } else pendientes.push(f); };
  function script(src){ var s = d.createElement("script"); s.async = true; s.src = src; d.head.appendChild(s); }

  /* Google tag: Ads en todas las rutas; GA4 solo en las públicas, sin page_view (lo manda <GaPageview/>). */
  w.dataLayer = w.dataLayer || [];
  w.gtag = w.gtag || function(){ w.dataLayer.push(arguments); };
  w.gtag('js', new Date());
  w.gtag('config', ${JSON.stringify(GOOGLE_ADS_ID)});
  if (!privada) w.gtag('config', ${JSON.stringify(GA4_MEASUREMENT_ID)}, { send_page_view: false });
  w.__dcDiferir(function(){ script(${JSON.stringify(URL_GTAG)}); });

  /* Píxel de Meta: el stub oficial (encola en fbq.queue), con la carga de fbevents.js diferida. */
  if (!privada && !w.fbq) {
    var n = w.fbq = function(){ n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!w._fbq) w._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    w.fbq('init', ${JSON.stringify(META_PIXEL_ID)});
    w.__dcDiferir(function(){ script(${JSON.stringify(URL_FBEVENTS)}); });
  }
})(window,document);`;
}
