// Píxel de TikTok — medición del SITIO PÚBLICO (ws1-t5, tanda ws7).
//
// «DaleControl Pixel», modo Pixel + Events API. El ID es público (viaja en claro
// al navegador), va como constante igual que META_PIXEL_ID y GA4_MEASUREMENT_ID.
// La regla de privacidad vive en isPrivatePath (@/lib/analytics/ga4): aquí no se
// duplica, solo se llama.
export const TIKTOK_PIXEL_ID = "DB6NHKJC77UDJT303SAG";

/** URL del SDK del píxel (con el código del píxel como parámetro, como el snippet oficial). */
export const TIKTOK_SDK_URL = "https://analytics.tiktok.com/i18n/pixel/events.js";

/**
 * Páginas de DaleControl donde SÍ carga el píxel de TikTok (lista BLANCA, no
 * negra): portada, precios, blog, registro y las landings de producto. Quedan
 * fuera —por no estar en la lista— las páginas públicas de las clínicas
 * (/[slug], micrositios, /cita, /resena, /r, /share…) y sus reservas
 * (/reservar/*), porque ahí los pacientes escriben sus datos y TikTok tiene
 * activado «enhanced data postback» (lee contenido y clics de la página).
 * Una ruta nueva de marketing se añade aquí a propósito; un slug de clínica
 * nunca coincide con estos nombres porque están reservados.
 */
const PAGINAS_EXACTAS = new Set(["/", "/signup", "/precios", "/roadmap"]);
const PREFIJOS = [
  "/blog",
  "/casos-de-uso",
  "/herramientas",
  "/software-agenda-dental",
  "/software-multiclinica-dental",
  "/caja-y-cobros-clinica-dental",
  "/expediente-clinico-dental",
  "/facturacion-dental-cfdi",
  "/portal-del-paciente-dental",
  "/radiografias-3d-cbct-dental",
  "/reportes-clinica-dental",
];

export function esPaginaDaleControl(pathname: string | null | undefined): boolean {
  const p = (pathname ?? "").split("?")[0].replace(/\/+$/, "") || "/";
  if (PAGINAS_EXACTAS.has(p)) return true;
  return PREFIJOS.some((x) => p === x || p.startsWith(`${x}/`));
}
