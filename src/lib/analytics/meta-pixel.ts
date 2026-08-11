// Píxel de Meta — medición del SITIO PÚBLICO.
//
// Conjunto de datos "DaleControl Web" en Events Manager. Es lo que le permite a
// Meta Ads optimizar a "vistas de la página de destino": sin píxel esa métrica
// no existe y la campaña no tiene a qué optimizar.
//
// OJO: en Business Manager hay además un conjunto de datos VIEJO de tipo app
// (1485010419522177), inactivo y con 0 eventos. No es ese. El bueno es el de
// abajo, el único que mide el sitio web.
//
// El ID va como constante en el código, mismo criterio que GA4_MEASUREMENT_ID y
// el tag de Google Ads (AW-18276007996, inline en el layout): son
// identificadores públicos —viajan en claro al navegador de todas formas—, no
// cambian entre entornos y no se ganan nada como variable de entorno; sí se
// perdería, porque un deploy sin la var dejaría la campaña midiendo cero en
// silencio.
export const META_PIXEL_ID = "1692815882024068";

// La regla de privacidad (no medir rutas de panel ni de paciente) NO se duplica
// aquí: vive entera en PRIVATE_PATH_PATTERN / isPrivatePath de
// @/lib/analytics/ga4, y de ahí la leen los dos únicos sitios que la aplican —
// el <Script> del layout, que decide si llega a hacer fbq('init'), y
// <MetaPixelPageview />, que decide si manda el PageView.
