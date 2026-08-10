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
