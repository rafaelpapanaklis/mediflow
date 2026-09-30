// Google Analytics 4 — medición del SITIO PÚBLICO.
//
// Convive con el tag de Google Ads (AW-18276007996) del root layout: gtag.js se
// carga UNA sola vez y sirve a varios destinos, así que GA4 se SUMA con un
// `config` extra. El tag de Ads no cambia: sigue cargando y midiendo
// conversiones en todas las rutas, también en las privadas.
//
// El ID va como constante en el código, mismo criterio que el de Ads (que está
// inline en el layout y en @/lib/gtag), no en variable de entorno.

export const GA4_MEASUREMENT_ID = "G-Q3HM012SPZ";

/**
 * Rutas de área privada: GA4 no se configura ni manda page_view en ellas, para
 * que la propiedad mida marketing y no el uso del producto.
 *
 * Áreas 100% privadas:
 *   /dashboard     panel de la clínica
 *   /admin         panel del owner
 *   /portal        enlaces por token del paciente (receta, documentos)
 *   /paciente      portal del paciente (panel + alta por invitación de la clínica)
 *   /proveedores   panel del marketplace B2B — la raíz solo redirige a login/panel
 *   /laboratorios  panel de laboratorios dentales — idem
 *   /onboarding    alta guiada post-signup
 *   /live, /tv     pantallas dentro de la clínica, se recargan solas
 *
 * /afiliados es MIXTA: la raíz es landing pública (está en el sitemap) y
 * login/registro/pendiente son el embudo de alta al que apuntan sus CTAs; todo
 * lo demás bajo /afiliados/ —el grupo (panel)— es área privada. La regla es
 * fail-closed y vive ENTERA en el lookahead de abajo: toda ruta NUEVA bajo
 * /afiliados/ nace excluida hasta que se añada ahí explícitamente. Por eso
 * /afiliados/vincular no se mide, aunque sea parte del alta.
 *
 * Nota: el criterio mira sólo el pathname, así que el `?inv=` de una invitación
 * entre afiliados no cambia nada: /afiliados/registro se sigue midiendo.
 *
 * Se exporta el patrón (string) además de la función porque el mismo criterio
 * corre en dos sitios: aquí, para el page_view del cliente, y dentro del
 * <Script> inline del layout, que decide si llega a configurar GA4.
 */
export const PRIVATE_PATH_PATTERN =
  "^/(?:dashboard|admin|portal|paciente|proveedores|laboratorios|onboarding|live|tv)(?:/|$)" +
  "|^/afiliados/(?!login$|registro$|pendiente$)";

const PRIVATE_PATH_RE = new RegExp(PRIVATE_PATH_PATTERN);

/** true → ruta de panel/área privada: no se mide en GA4. */
export function isPrivatePath(pathname: string): boolean {
  return PRIVATE_PATH_RE.test(pathname);
}

// ── Eventos de negocio (WS1-T6) ─────────────────────────────────────────────
//
// `sign_up` y `purchase` son los eventos RECOMENDADOS de GA4; salen junto a las
// conversiones de Google Ads (@/lib/gtag), que no cambian ni se reemplazan.
// Todos llevan `send_to: GA4_MEASUREMENT_ID`: sin él gtag los emitiría también
// al destino de Ads (AW-…), que ya tiene sus propias conversiones.
//
// Nunca lanzan ni navegan: sin window o sin gtag devuelven false y la pantalla
// funciona igual (bloqueador de anuncios).

type GtagFn = (...args: unknown[]) => void;

function gtagDelNavegador(): GtagFn | null {
  if (typeof window === "undefined") return null;
  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  return typeof gtag === "function" ? gtag : null;
}

/**
 * `sign_up` de GA4. /signup es ruta PÚBLICA: el layout ya configuró GA4 ahí, no
 * hace falta `config`. Devuelve true solo si el evento salió hacia gtag.
 */
export function trackGa4SignUp(method: string = "email"): boolean {
  const gtag = gtagDelNavegador();
  if (!gtag) return false;
  try {
    gtag("event", "sign_up", { send_to: GA4_MEASUREMENT_ID, method });
    return true;
  } catch {
    return false;
  }
}

export interface Ga4Purchase {
  /** Id de la sesión de Checkout de Stripe (cs_…): el MISMO de «Pago completado». */
  transactionId: string;
  /** Importe SIN IVA, con el cupón ya descontado, en pesos: el MISMO de «Pago completado». */
  valueMxn: number;
  /** ISO-4217 en mayúsculas; por defecto MXN. */
  currency?: string;
  /** Plan contratado (BASIC | PRO | CLINIC) y su nombre, para `items`. */
  item?: { id: string; name: string; variant?: string };
}

/** `purchase` con la forma exacta que GA4 espera (sin efectos, se prueba solo). */
export function ga4PurchaseParams(p: Ga4Purchase): Record<string, unknown> {
  const value = p.valueMxn;
  return {
    send_to: GA4_MEASUREMENT_ID,
    transaction_id: p.transactionId,
    value,
    currency: p.currency ?? "MXN",
    ...(p.item
      ? {
          items: [
            {
              item_id: p.item.id,
              item_name: p.item.name,
              ...(p.item.variant ? { item_variant: p.item.variant } : {}),
              price: value,
              quantity: 1,
            },
          ],
        }
      : {}),
  };
}

/**
 * `purchase` de GA4. Devuelve true solo si el evento salió hacia gtag. La
 * protección contra repetidos (una vez por session_id) la pone quien llama,
 * junto con la conversión de Ads; GA4 además deduplica `purchase` por
 * transaction_id.
 *
 * SIN `gtag('config', G-…)`, a propósito, también en la pantalla privada. Un
 * config es estado de la PESTAÑA: en el panel (SPA, next/link) seguiría vivo
 * después del pago y la medición mejorada de GA4 mandaría desde ahí page_view
 * por cada navegación, scroll, descargas y clics salientes (wa.me/<teléfono de
 * un paciente> incluido). Medido con gtag.js real (26-sep-2026): con config,
 * tras el purchase salieron page_view/scroll/click del panel; sin config, solo
 * el purchase. gtag carga el contenedor de GA4 al ver el `send_to`, así que el
 * evento llega igual. Es comportamiento no documentado de gtag.js: por eso hay
 * un paso de QA (DebugView) que confirma que el purchase entra.
 *
 * `page_location` va sin query: el session_id de Stripe no viaja como URL.
 */
export function trackGa4Purchase(p: Ga4Purchase): boolean {
  const gtag = gtagDelNavegador();
  if (!gtag) return false;
  try {
    gtag("event", "purchase", {
      ...ga4PurchaseParams(p),
      page_location: `${window.location.origin}${window.location.pathname}`,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * `select_promotion` de GA4 (recomendado): clic en un anuncio de DaleControl
 * dentro de un artículo del blog. `promotion_id` es el sufijo del title del
 * enlace (pro, basico, anual…). Va con `send_to` a GA4, así que NO genera
 * conversión de Google Ads. Nunca lanza; sin gtag devuelve false.
 */
export function trackGa4SelectPromotion(promotionId: string): boolean {
  const gtag = gtagDelNavegador();
  if (!gtag) return false;
  try {
    gtag("event", "select_promotion", {
      send_to: GA4_MEASUREMENT_ID,
      promotion_id: promotionId,
      promotion_name: `blog-anuncio-${promotionId}`,
      creative_name: "blog-anuncio",
    });
    return true;
  } catch {
    return false;
  }
}
