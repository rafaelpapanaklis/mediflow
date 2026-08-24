/* ═══════════════════════════════════════════════════════════════════════
   SEO DE LA PÁGINA DE UNA BARBERÍA.

   Esta página es, para muchas barberías, su ÚNICO sitio: lo que ponen en
   la bio de Instagram y lo que Google indexa. Así que el título, la
   descripción, la imagen social y el JSON-LD no son un adorno.

   ── EL TIPO ES `HealthAndBeautyBusiness` ──────────────────────────
   Nunca nada médico. Una barbería no es una clínica: marcarla como
   `MedicalBusiness` sería falso, y Google lo trata como contenido de
   salud (criterios más duros, otros competidores, otra intención de
   búsqueda). `HealthAndBeautyBusiness` es el tipo de schema.org para
   barberías, salones y estética.

   ── LO QUE NO SE PONE, Y POR QUÉ ──────────────────────────────────
   `aggregateRating` y `review`. Las reseñas de esta página las escribe
   la propia barbería en su editor: no vienen de Google ni de un tercero
   verificable. Marcarlas como reseñas estructuradas sería pedirle a
   Google que pinte estrellas en el buscador a partir de un texto que
   escribió el propio negocio — que es exactamente lo que sus guías de
   reseñas autogeneradas prohíben, y por lo que se penaliza el sitio
   entero. Se pintan en la página, no en el JSON-LD.
   ═══════════════════════════════════════════════════════════════════════ */

import {
  BARBER_WEB_DIAS,
  direccionCompleta,
  precioBarberWeb,
  urlFacebook,
  urlInstagram,
  urlTiktok,
  type BarberWebConfig,
} from "@/lib/barber/landing";
import type { BarberWebServicio, BarberWebShop } from "@/components/barber/templates/types";

const DIA_SCHEMA = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** El título que sale en la pestaña y en Google. */
export function tituloSeo(nombre: string, ciudad: string | null, config: BarberWebConfig): string {
  if (config.seoTitulo) return config.seoTitulo;
  return ciudad ? `${nombre} — Barbería en ${ciudad}` : `${nombre} — Barbería`;
}

/** La descripción de Google. 155 caracteres es lo que se ve completo. */
export function descripcionSeo(
  nombre: string,
  ciudad: string | null,
  config: BarberWebConfig,
): string {
  if (config.seoDescripcion) return config.seoDescripcion;
  const donde = ciudad ? ` en ${ciudad}` : "";
  return `Corte de cabello, barba y afeitado${donde}. Reserva tu cita en línea con ${nombre}: elige barbero, servicio y horario en un minuto.`.slice(
    0,
    155,
  );
}

/** La imagen que se ve al compartir el enlace. */
export function imagenSocial(config: BarberWebConfig, logoUrl: string | null): string | null {
  return config.ogImagen ?? config.fotos.portada ?? config.galeria[0] ?? config.fotos.logo ?? logoUrl;
}

export interface DatosJsonLd {
  shop: BarberWebShop;
  config: BarberWebConfig;
  servicios: BarberWebServicio[];
  url: string;
}

/** El bloque JSON-LD de la barbería. */
export function jsonLdBarberia({ shop, config, servicios, url }: DatosJsonLd): object {
  const dir = direccionCompleta(shop);
  const imagenes = [config.fotos.portada, ...config.galeria.slice(0, 5)].filter(Boolean);
  const redes = [urlInstagram(config.instagram), urlFacebook(config.facebook), urlTiktok(config.tiktok)].filter(
    Boolean,
  );

  const horario = config.horario
    .filter((d) => d.abierto && d.dia >= 0 && d.dia <= 6)
    .map((d) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: DIA_SCHEMA[d.dia],
      opens: d.desde,
      closes: d.hasta,
    }));

  const precios = servicios.map((s) => s.precio).filter((n) => Number.isFinite(n) && n > 0);
  const rango =
    precios.length > 0
      ? precios.length === 1 || Math.min(...precios) === Math.max(...precios)
        ? precioBarberWeb(precios[0])
        : `${precioBarberWeb(Math.min(...precios))} – ${precioBarberWeb(Math.max(...precios))}`
      : null;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "HealthAndBeautyBusiness",
    name: shop.name,
    url,
    "@id": url,
  };

  if (imagenes.length > 0) ld.image = imagenes;
  if (config.fotos.logo ?? shop.logoUrl) ld.logo = config.fotos.logo ?? shop.logoUrl;
  if (shop.phone) ld.telephone = shop.phone;
  if (dir) {
    ld.address = {
      "@type": "PostalAddress",
      streetAddress: shop.address ?? undefined,
      addressLocality: shop.city ?? undefined,
      addressRegion: shop.state ?? undefined,
      addressCountry: "MX",
    };
  }
  if (horario.length > 0) ld.openingHoursSpecification = horario;
  if (rango) ld.priceRange = rango;
  if (redes.length > 0) ld.sameAs = redes;

  if (servicios.length > 0) {
    ld.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: "Servicios",
      itemListElement: servicios.slice(0, 40).map((s) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: s.nombre,
          ...(s.descripcion ? { description: s.descripcion } : {}),
        },
        price: s.precio.toFixed(2),
        priceCurrency: "MXN",
      })),
    };
  }

  return ld;
}

/**
 * El JSON-LD listo para meter en un `<script>`.
 *
 * 🔒 Todo signo de "menor que" sale como su escape unicode de JSON. NO es
 * cosmética: el nombre de la barbería, su dirección y todo el texto del
 * editor entran en esta cadena, y `JSON.stringify` escapa las comillas
 * pero NO la barra. Una barbería llamada `Fade [cierre de script]…`
 * cerraría el bloque y ejecutaría lo que quisiera en una página pública,
 * cacheada por ISR y servida a todos sus clientes. Escapado, el JSON
 * sigue siendo válido (el parser lo desescapa solo) y no hay forma de
 * salir de la etiqueta.
 *
 * De paso: las claves `undefined`/`null` se caen, porque `address` puede
 * quedarse con dos de tres vacías si la barbería solo capturó la calle.
 */
export function serializarJsonLd(ld: object): string {
  return JSON.stringify(ld, (_k, v) => (v === undefined || v === null ? undefined : v)).replace(
    /</g,
    "\\u003c",
  );
}
