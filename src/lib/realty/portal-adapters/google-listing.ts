// ═══════════════════════════════════════════════════════════════════════
// ADAPTADOR: JSON-LD `RealEstateListing` para LA WEB PROPIA del cliente.
//
// El destino aquí no es un portal ajeno: es la ficha del inmueble en
// /i/<slug>/<inmueble>. Google (y Bing, y quien lea schema.org) entiende ese
// bloque y puede pintar precio, recámaras y foto directo en el resultado.
// Es el único "portal" en el que el cliente no le paga a nadie.
//
// Por qué vive junto a los adaptadores y no en un seo.ts suelto: son los
// MISMOS datos y la MISMA reja de privacidad. Si la dirección exacta está
// apagada, tampoco puede salir en el marcado de la web propia — un bloque
// JSON-LD es tan público como un feed, y ahí se olvida más fácil.
//
// 🔴 Dos consumidores, dos funciones:
//    realtyListingLd(...)      → el objeto (para <script> en la web propia)
//    googleListingAdapter.build → un ItemList serializado (feed .json de
//                                 depuración: ver qué se está publicando)
//
// 🔴 SERIALIZACIÓN SEGURA: dentro de un <script> el JSON no puede llevar un
// "<" crudo. Un título que contenga "</script>" partiría la etiqueta en dos
// y lo que siga se ejecuta como HTML. serializeRealtyLd() lo escapa, igual
// que JsonLd de src/components/blog/json-ld.tsx.
//
// Módulo PURO.
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyPropertyKind } from "@/lib/realty/types";
import { realtyAmenityLabel } from "@/lib/realty/types";
import {
  flattenText,
  type RealtyPortalAdapter,
  type RealtyPublishableProperty,
  type RealtyPublisherAccount,
} from "@/lib/realty/portal-adapters/types";

/**
 * Tipo schema.org del inmueble. Solo lo residencial tiene tipo propio;
 * terreno, bodega, local, oficina y rancho caen a `Place`, que es el tipo
 * honesto — inventar un `Residence` para una bodega es marcado falso y
 * Google lo penaliza más que no ponerlo.
 */
const SCHEMA_TYPE: Record<RealtyPropertyKind, string> = {
  CASA: "SingleFamilyResidence",
  DEPARTAMENTO: "Apartment",
  EDIFICIO: "ApartmentComplex",
  TERRENO: "Place",
  BODEGA: "Place",
  LOCAL: "Place",
  OFICINA: "Place",
  RANCHO: "Place",
};

/** Disponibilidad schema.org a partir del estatus comercial. */
function availabilityUrl(p: RealtyPublishableProperty): string {
  switch (p.status) {
    case "DISPONIBLE":
      return "https://schema.org/InStock";
    case "APARTADO":
      return "https://schema.org/LimitedAvailability";
    default:
      return "https://schema.org/SoldOut";
  }
}

/**
 * El objeto `RealEstateListing` de UN inmueble.
 *
 * Se construye añadiendo claves SOLO si hay dato (mismo criterio que
 * jsonLdBarberia): una clave con null en el marcado estructurado es peor
 * que la ausencia de la clave — los validadores la reportan como error.
 */
export function realtyListingLd(
  p: RealtyPublishableProperty,
  account: RealtyPublisherAccount,
): Record<string, unknown> {
  const address: Record<string, unknown> = { "@type": "PostalAddress", addressCountry: "MX" };
  // streetAddress solo si el propietario autorizó publicar la calle.
  if (p.address) address.streetAddress = p.address;
  // addressLocality = municipio/ciudad; la colonia es un barrio y va en
  // addressNeighborhood si hay ciudad, no pisando la localidad.
  if (p.city) address.addressLocality = p.city;
  else if (p.colonia) address.addressLocality = p.colonia;
  if (p.colonia && p.city) address.addressNeighborhood = p.colonia;
  if (p.state) address.addressRegion = p.state;
  if (p.zip) address.postalCode = p.zip;

  const about: Record<string, unknown> = {
    "@type": SCHEMA_TYPE[p.kind],
    name: flattenText(p.title, 200),
    address,
  };
  if (p.bedrooms !== null) about.numberOfRooms = p.bedrooms;
  if (p.bathrooms !== null) about.numberOfBathroomsTotal = p.bathrooms;
  if (p.builtM2 !== null) {
    // unitCode MTK = metro cuadrado en UN/CEFACT, que es lo que pide
    // QuantitativeValue. "m2" a secas no lo entiende ningún validador.
    about.floorSize = { "@type": "QuantitativeValue", value: p.builtM2, unitCode: "MTK" };
  }
  if (p.landM2 !== null) {
    about.lotSize = { "@type": "QuantitativeValue", value: p.landM2, unitCode: "MTK" };
  }
  if (p.amenities.length > 0) {
    about.amenityFeature = p.amenities.map((key) => ({
      "@type": "LocationFeatureSpecification",
      name: realtyAmenityLabel(key),
      value: true,
    }));
  }
  // Las coordenadas son la dirección exacta con otro nombre: si el
  // propietario la apagó, feed.ts ya las dejó en null y aquí no aparecen.
  if (p.lat !== null && p.lng !== null) {
    about.geo = { "@type": "GeoCoordinates", latitude: p.lat, longitude: p.lng };
  }

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    "@id": p.url,
    url: p.url,
    name: flattenText(p.title, 200),
    datePosted: p.createdAt,
    about,
    offers: {
      "@type": "Offer",
      price: p.price,
      priceCurrency: p.currency,
      availability: availabilityUrl(p),
      url: p.url,
      seller: { "@type": "RealEstateAgent", name: account.name, url: account.webUrl },
    },
  };
  if (p.description) ld.description = flattenText(p.description, 5000);
  if (p.photos.length > 0) ld.image = p.photos.map((f) => f.url);
  if (p.tours.length > 0) {
    // El recorrido virtual también se declara: es lo que distingue una ficha
    // que se puede recorrer de una con fotos.
    ld.tourBookingPage = p.tours[0].url;
  }
  return ld;
}

/**
 * JSON listo para inyectar en `<script type="application/ld+json">`.
 * Escapa "<" a < — el único vector real aquí es un título con una
 * etiqueta de cierre de script dentro.
 */
export function serializeRealtyLd(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (v === undefined || v === null ? undefined : v)).replace(
    /</g,
    "\\u003c",
  );
}

export const googleListingAdapter: RealtyPortalAdapter = {
  key: "google-listing",
  label: "Datos estructurados de tu propia web (Google)",
  transport: "feed",
  contentType: "application/ld+json; charset=utf-8",
  filename: "google.jsonld",

  build(properties, account): string {
    const ld = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Inmuebles de ${flattenText(account.name, 120)}`,
      url: account.webUrl,
      numberOfItems: properties.length,
      itemListElement: properties.map((p, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: realtyListingLd(p, account),
      })),
    };
    return `${JSON.stringify(ld, null, 2)}\n`;
  },
};
