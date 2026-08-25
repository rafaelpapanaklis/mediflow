// ═══════════════════════════════════════════════════════════════════════
// ADAPTADOR: CATÁLOGO DE META (Facebook / Instagram) — "Home Listings".
//
// 🔴 LO QUE ESTO ES Y LO QUE NO ES. Léelo antes de escribir un solo texto
// de UI encima.
//
//   SÍ  → catálogo de inmuebles para ANUNCIOS DINÁMICOS de Facebook e
//         Instagram. El cliente sube este archivo (o la URL) a su catálogo
//         en el Administrador Comercial y desde ahí lanza campañas.
//   NO  → publicar en Facebook Marketplace. Desde enero de 2023 Marketplace
//         dejó de permitir publicaciones individuales de propiedades hechas
//         por páginas de negocio o por plataformas de terceros, y el acceso
//         que queda es beta cerrada. Por eso este archivo se llama
//         meta-catalog y la pantalla dice "anuncios de Facebook e
//         Instagram", NUNCA "publicar en Marketplace". Prometer Marketplace
//         es un reclamo garantizado y no lo podemos cumplir.
//
// FORMATO: CSV con encabezado, que es el formato documentado y sin
// ambigüedades para Home Listings. Se sirve como texto/csv en su propia URL
// (meta.csv) en vez de disfrazarlo de .xml: una extensión que miente es la
// primera cosa que rompe una integración.
//
// Módulo PURO. build() devuelve string, igual que todos los adaptadores.
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyPropertyKind, RealtyPropertyStatus } from "@/lib/realty/types";
import {
  flattenText,
  feedNumber,
  type RealtyPortalAdapter,
  type RealtyPublishableProperty,
} from "@/lib/realty/portal-adapters/types";

/**
 * Columnas del catálogo Home Listings, en el orden en que se escriben.
 * Los nombres son los que espera Meta; cambiarlos rompe la carga.
 */
const COLUMNS = [
  "home_listing_id",
  "name",
  "availability",
  "description",
  "price",
  "url",
  "image[0].url",
  "address",
  "neighborhood[0]",
  "latitude",
  "longitude",
  "property_type",
  "listing_type",
  "num_beds",
  "num_baths",
  "area_size",
  "area_unit",
  "year_built",
  "agent_name",
  "agent_phone",
  "agent_company",
] as const;

/** Tipo de inmueble en el vocabulario de Meta. */
const PROPERTY_TYPE: Record<RealtyPropertyKind, string> = {
  CASA: "house",
  DEPARTAMENTO: "apartment",
  TERRENO: "land",
  BODEGA: "other",
  LOCAL: "other",
  EDIFICIO: "other",
  OFICINA: "other",
  RANCHO: "other",
};

/**
 * Disponibilidad en el vocabulario de Meta. El feed solo lleva DISPONIBLE,
 * pero el mapa cubre los cuatro estatus: cuando un inmueble se vende, lo
 * correcto NO es borrarlo del catálogo sino mandarlo como `sold` para que
 * Meta deje de gastarle presupuesto. Ver despublicación en portals.ts.
 */
const AVAILABILITY: Record<RealtyPropertyStatus, string> = {
  DISPONIBLE: "for_sale",
  APARTADO: "available_soon",
  VENDIDO: "sold",
  RENTADO: "rented",
};

function availabilityFor(p: RealtyPublishableProperty): string {
  if (p.status !== "DISPONIBLE") return AVAILABILITY[p.status];
  return p.operation === "RENTA" ? "for_rent" : "for_sale";
}

/** `for_sale_by_agent` / `for_rent_by_agent`: publica la inmobiliaria. */
function listingTypeFor(p: RealtyPublishableProperty): string {
  return p.operation === "RENTA" ? "for_rent_by_agent" : "for_sale_by_agent";
}

/**
 * Una celda CSV. Se entrecomilla SIEMPRE que haya coma, comilla o salto de
 * línea, y la comilla interna se duplica (RFC 4180). Una descripción con una
 * coma sin escapar corre todas las columnas siguientes y el catálogo carga
 * el teléfono en el campo del precio sin avisar de nada.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = flattenText(String(value), 5000);
  if (raw === "") return "";
  if (/[",\r\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

/**
 * Dirección en el formato compuesto que pide Meta. Cuando el propietario no
 * autorizó publicar la calle, va SOLO colonia/ciudad/estado: la reja está
 * en feed.ts (address llega null) y aquí no hay forma de recuperarla.
 */
function addressCell(p: RealtyPublishableProperty): string {
  const parts: string[] = [];
  if (p.address) parts.push(`"addr1":${JSON.stringify(p.address)}`);
  if (p.city) parts.push(`"city":${JSON.stringify(p.city)}`);
  if (p.state) parts.push(`"region":${JSON.stringify(p.state)}`);
  parts.push('"country":"MX"');
  if (p.zip) parts.push(`"postal_code":${JSON.stringify(p.zip)}`);
  return `{${parts.join(",")}}`;
}

export const metaCatalogAdapter: RealtyPortalAdapter = {
  key: "meta-catalog",
  label: "Catálogo de Meta (anuncios de Facebook e Instagram)",
  transport: "feed",
  contentType: "text/csv; charset=utf-8",
  filename: "meta.csv",

  build(properties, account, options): string {
    const rows: string[] = [COLUMNS.join(",")];

    for (const p of properties) {
      const cover = p.photos.find((f) => f.isCover) ?? p.photos[0] ?? null;
      const year = (() => {
        if (p.ageYears === null) return null;
        const y = Number(String(options.generatedAt).slice(0, 4));
        return Number.isFinite(y) && y > 1900 ? String(y - p.ageYears) : null;
      })();

      rows.push(
        [
          csvCell(p.id),
          csvCell(flattenText(p.title, 200)),
          csvCell(availabilityFor(p)),
          csvCell(flattenText(p.description ?? p.title, 5000)),
          // Meta pide "monto MONEDA" en una sola celda.
          csvCell(`${feedNumber(p.price) ?? "0"} ${p.currency}`),
          csvCell(p.url),
          csvCell(cover?.url ?? ""),
          csvCell(addressCell(p)),
          csvCell(p.colonia ?? ""),
          csvCell(feedNumber(p.lat)),
          csvCell(feedNumber(p.lng)),
          csvCell(PROPERTY_TYPE[p.kind]),
          csvCell(listingTypeFor(p)),
          csvCell(p.bedrooms),
          csvCell(p.bathrooms),
          csvCell(feedNumber(p.builtM2 ?? p.landM2)),
          csvCell("sq_m"),
          csvCell(year),
          csvCell(account.name),
          csvCell(account.phone),
          csvCell(account.name),
        ].join(","),
      );
    }

    // Con cero inmuebles queda el encabezado solo: un catálogo vacío VÁLIDO.
    // Meta lo acepta y no marca la fuente como rota.
    return `${rows.join("\r\n")}\r\n`;
  },
};
