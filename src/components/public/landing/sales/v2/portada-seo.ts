/**
 * SEO de la portada (12-oct-2026, ws1-t4, punto 3 del encargo de ws7): lo que
 * antes vivía escrito a mano dentro de `metadata` en src/app/page.tsx.
 *
 * · La meta description iba en 167 caracteres y con dos precios pegados en el
 *   texto («Desde $419 al mes… primer mes por solo $19»). Google corta en ~155 y
 *   los precios salen de `plan_configs` (regla d de CLAUDE.md), así que la
 *   descripción se arma aquí con la etiqueta del primer mes que ya calcula
 *   page.tsx y la portada pasa a `generateMetadata`.
 * · `sameAs` del JSON-LD de la Organización: Instagram, Facebook y TikTok con
 *   el mismo usuario (@dalecontrol.com, el que dio ws7). Se exporta como lista
 *   para que /llms.txt diga lo mismo.
 *
 * · 7-nov-2026: texto fijo elegido por Rafael (166 caracteres, sin precio); sabe que en escritorio Google lo corta.
 *
 * Sin JSX ni CSS: se prueba con tsx (portada-seo.test.ts).
 */

/**
 * Tope de Google para la descripción en resultados móviles. Desde el 7-nov-2026 la
 * descripción de la portada lo rebasa a propósito (texto de Rafael); se conserva como referencia.
 */
export const DESCRIPCION_MAX = 155;

/** Usuario único en las tres redes. */
export const USUARIO_REDES = "dalecontrol.com";

export const REDES_SOCIALES: readonly { red: "Instagram" | "Facebook" | "TikTok"; url: string }[] = [
  { red: "Instagram", url: `https://www.instagram.com/${USUARIO_REDES}/` },
  { red: "Facebook", url: `https://www.facebook.com/${USUARIO_REDES}` },
  { red: "TikTok", url: `https://www.tiktok.com/@${USUARIO_REDES}` },
];

/** Lo que va en `Organization.sameAs`. */
export const SAME_AS: readonly string[] = REDES_SOCIALES.map((r) => r.url);

export const TITULO_PORTADA = "DaleControl · El software dental más completo de México";

/** Texto exacto elegido por Rafael el 7-nov-2026 (166 caracteres, sin precio). */
export function descripcionPortada(): string {
  return "DaleControl el mejor software para tu clínica dental y consultorios en México. Organiza tu clínica dental en un solo lugar con la mejor tecnología y con IA integrada.";
}
