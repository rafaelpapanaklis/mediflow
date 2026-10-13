import { PRODUCTO_MODULES, PRODUCTO_SLUGS } from "@/lib/producto/data";
import { SITE_URL } from "@/lib/seo";
import { REDES_SOCIALES } from "@/components/public/landing/sales/v2/portada-seo";

/**
 * Texto de /llms.txt (12-oct-2026, ws1-t4, punto 3e del encargo de ws7): el
 * resumen del sitio para los asistentes de IA (formato de llmstxt.org: un H1, un
 * párrafo en `>`, y secciones H2 con listas «- [título](url): nota»).
 *
 * BORRADOR: ws7 entrega el texto definitivo si Rafael se lo pide; mientras,
 * este sale de lo que ya dice el sitio (metaTitle de las 8 páginas de producto,
 * portada, blog, casos y herramientas). Sin cifras de precio: cambian desde
 * /admin/settings → Planes y aquí quedarían viejas. Sin número de clientes.
 *
 * Vive fuera de route.ts porque Next solo admite en una ruta los exports que
 * conoce (GET, dynamic…); se prueba con tsx (llms-txt.test.ts).
 */
export function textoLlms(): string {
  const producto = PRODUCTO_SLUGS.map((slug) => {
    const m = PRODUCTO_MODULES[slug];
    return `- [${m.metaTitle}](${SITE_URL}/${slug})`;
  });
  const redes = REDES_SOCIALES.map((r) => `- [${r.red}](${r.url})`);

  return [
    "# DaleControl",
    "",
    "> Software de gestión para clínicas dentales en México: agenda con recordatorios y bot de WhatsApp, " +
      "expediente clínico con odontograma, visor de radiografías y CBCT 3D, caja y cobros, facturación CFDI 4.0, " +
      "portal del paciente, reportes y varias sedes en una sola cuenta. Se usa desde el navegador, con prueba " +
      "del primer mes a precio reducido y planes mensuales o anuales en pesos mexicanos.",
    "",
    "DaleControl (dalecontrol.com) está hecho para consultorios y clínicas dentales de México. La IA del " +
      "producto asiste al doctor (análisis de radiografías 2D, dictado de notas, asistente Sabina) y el doctor " +
      "decide. Los precios vigentes están siempre en la portada; no se publican aquí para no quedar desactualizados.",
    "",
    "## Páginas principales",
    "",
    `- [Portada](${SITE_URL}/): qué hace el software, planes y preguntas frecuentes`,
    `- [Casos de uso](${SITE_URL}/casos-de-uso): cómo lo usan clínicas de ortodoncia, implantes, odontopediatría, endodoncia y estética`,
    `- [Herramientas gratuitas](${SITE_URL}/herramientas): calculadoras y generadores para clínicas dentales`,
    `- [Blog](${SITE_URL}/blog): artículos sobre gestión de clínicas dentales`,
    `- [Directorio de clínicas](${SITE_URL}/descubre): clínicas que usan DaleControl, por especialidad y ciudad`,
    `- [Programa de afiliados](${SITE_URL}/afiliados)`,
    "",
    "## Funciones (una página por módulo)",
    "",
    ...producto,
    "",
    "## Redes sociales",
    "",
    ...redes,
    "",
    "## Contacto",
    "",
    `- [WhatsApp y chat en vivo desde la portada](${SITE_URL}/)`,
    "",
  ].join("\n");
}

