import type { MetadataRoute } from "next";
import {
  rutaAgenteWeb,
  rutaContactoWeb,
  rutaInmuebleWeb,
  rutaPropiedadesWeb,
  rutaWebInmobiliaria,
} from "@/lib/realty/landing";
import { entradasSitemapRealty } from "./[slug]/_shared/data";
import { BASE_URL } from "./[slug]/_shared/seo";

/* ═══════════════════════════════════════════════════════════════════════
   SITEMAP PROPIO DEL VERTICAL: /i/sitemap.xml

   ── POR QUÉ UNO PROPIO Y NO UN BLOQUE EN src/app/sitemap.ts ───────
   Ese archivo es COMPARTIDO: lo usan el dental (vivo, con clínicas que
   pagan) y barber. Tocarlo desde aquí obligaría a declararlo en
   REALTY_GUARD_SHARED y a que diez terminales se pelearan por el mismo
   archivo en la misma ola. Un `sitemap.ts` dentro de un segmento genera su
   propio /i/sitemap.xml, que es exactamente lo que hace falta, y no toca
   nada de nadie.

   El precio de esta decisión: /i/sitemap.xml NO está referenciado desde
   /robots.txt (que sí es compartido). Se da de alta a mano en Search
   Console — está anotado en el reporte de la ola.

   ── QUÉ SE LISTA ─────────────────────────────────────────────────
   Solo cuentas ACTIVAS, con la suscripción al corriente y la web
   encendida. Una cuenta que apagó su página se sirve con noindex, así que
   listarla sería pedirle a Google que rastree una URL que le dice que no
   la indexe. La consulta ya aplica ese filtro (entradasSitemapRealty).

   Todo va dentro de un try/catch en el cargador: el build de Vercel corre
   sin garantía de DATABASE_URL y un sitemap vacío es infinitamente mejor
   que un build caído.
   ═══════════════════════════════════════════════════════════════════════ */

// Se regenera con el mismo reloj que las páginas que lista. Sin esto, un
// inmueble nuevo tardaría hasta el siguiente deploy en aparecer.
export const revalidate = 3600;

/** Tope de URLs por sitemap. El límite del formato son 50 000. */
const TOPE = 45_000;

export default async function sitemapInmuebles(): Promise<MetadataRoute.Sitemap> {
  const cuentas = await entradasSitemapRealty();
  const out: MetadataRoute.Sitemap = [];

  for (const c of cuentas) {
    if (out.length >= TOPE) break;

    out.push({
      url: `${BASE_URL}${rutaWebInmobiliaria(c.slug)}`,
      lastModified: c.actualizado,
      changeFrequency: "daily",
      priority: 0.9,
    });
    out.push({
      url: `${BASE_URL}${rutaPropiedadesWeb(c.slug)}`,
      lastModified: c.actualizado,
      changeFrequency: "daily",
      priority: 0.8,
    });
    out.push({
      url: `${BASE_URL}${rutaContactoWeb(c.slug)}`,
      lastModified: c.actualizado,
      changeFrequency: "monthly",
      priority: 0.4,
    });

    for (const agente of c.agentes) {
      if (out.length >= TOPE) break;
      out.push({
        url: `${BASE_URL}${rutaAgenteWeb(c.slug, agente)}`,
        lastModified: c.actualizado,
        changeFrequency: "weekly",
        // Más alta que el listado a propósito: la página del asesor es
        // contenido único (sus zonas, su historial) y es la que NO debe
        // canibalizarse con las de sus compañeros.
        priority: 0.7,
      });
    }

    for (const inm of c.inmuebles) {
      if (out.length >= TOPE) break;
      out.push({
        url: `${BASE_URL}${rutaInmuebleWeb(c.slug, inm.ref)}`,
        lastModified: inm.actualizado,
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  return out;
}
