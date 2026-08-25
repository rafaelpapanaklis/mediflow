// ═══════════════════════════════════════════════════════════════════════
// ADAPTADOR: FEED XML GENÉRICO (estilo Trovit / LIFULL Connect).
//
// Es el que sirve HOY, sin permiso de nadie: el portal se suscribe a una URL
// y la jala cada tanto. No hay credenciales, no hay convenio, no hay API.
// Publicar = entrar al feed. Despublicar = salir de él.
//
// A quién le sirve este formato:
//   · LIFULL Connect (Trovit, Mitula, Nuroa, Nestoria, iCasas) — la familia
//     de agregadores que popularizó justamente esta estructura.
//   · Portales chicos y agregadores que piden "un XML con tus propiedades".
//
// ⚠️ HONESTIDAD SOBRE EL FORMATO: cada portal tiene sus manías (nombres de
// campo extra, valores concretos para el tipo de operación, límites de
// fotos). Esta es la estructura común, la que casi todos aceptan tal cual,
// pero al dar de alta la URL hay que confirmar el mapeo con cada portal. La
// UI lo dice con esas palabras — prometer "compatible con todos" es un
// reclamo garantizado.
//
// Módulo PURO: sin prisma, sin fetch, sin fechas del sistema (generatedAt
// entra por opciones). Se puede probar con un objeto a mano.
// ═══════════════════════════════════════════════════════════════════════
import {
  REALTY_PROPERTY_KIND_LABELS,
  type RealtyOperation,
} from "@/lib/realty/types";
import {
  cdata,
  feedNumber,
  flattenText,
  xmlEscape,
  type RealtyAdapterOptions,
  type RealtyPortalAdapter,
  type RealtyPublishableProperty,
  type RealtyPublisherAccount,
} from "@/lib/realty/portal-adapters/types";

/**
 * Operación en las palabras que esperan los agregadores. AMBAS no existe
 * allá afuera: un anuncio es de venta o es de renta. Cuando el inmueble
 * admite las dos, mandamos "Venta" y el precio de venta — que es el que
 * ordena y filtra bien en el portal — y la renta se menciona en el texto.
 */
function operationLabel(operation: RealtyOperation): string {
  return operation === "RENTA" ? "Renta" : "Venta";
}

/** Texto seguro dentro de un comentario XML (sin "--" y sin terminar en "-"). */
function xmlComment(value: string): string {
  return xmlEscape(value).replace(/-{2,}/g, "-").replace(/-$/, "");
}

/** Un solo `<ad>`. Devuelve "" si el inmueble no tiene nada que decir. */
function buildAd(
  p: RealtyPublishableProperty,
  account: RealtyPublisherAccount,
  options: RealtyAdapterOptions,
): string {
  const lines: string[] = ["    <ad>"];
  const put = (tag: string, value: string | null | undefined): void => {
    if (value === null || value === undefined || value === "") return;
    lines.push(`      <${tag}>${cdata(value)}</${tag}>`);
  };

  // Identidad. Se manda el folio COMO ALIAS, no como id: el id tiene que ser
  // estable de por vida y el folio se puede regenerar.
  put("id", p.id);
  put("url", p.url);
  put("title", flattenText(p.title, 200));
  put("type", REALTY_PROPERTY_KIND_LABELS[p.kind]);
  put("property_type", REALTY_PROPERTY_KIND_LABELS[p.kind]);
  put("operation", operationLabel(p.operation));
  put("content", flattenText(p.description, 4000));
  put("reference", p.folio);

  // Dinero. El precio que va es el de la operación principal (ver feed.ts).
  put("price", feedNumber(p.price));
  put("currency", p.currency);
  if (p.operation === "AMBAS" && p.rentPrice !== null) {
    // Extra fuera del estándar: los agregadores ignoran lo que no conocen y
    // el portal que sí lo lea gana un dato que si no se pierde.
    put("rent_price", feedNumber(p.rentPrice));
  }
  put("maintenance_fee", feedNumber(p.maintenanceFee));

  // Ubicación. La calle solo sale si el propietario dejó publicarla; la
  // colonia y la ciudad SIEMPRE (sin ellas el anuncio no se puede filtrar y
  // el portal lo descarta).
  put("address", p.address);
  put("neighborhood", p.colonia);
  put("city", p.city);
  put("region", p.state);
  put("country", "México");
  put("postcode", p.zip);
  if (p.lat !== null && p.lng !== null) {
    put("latitude", feedNumber(p.lat));
    put("longitude", feedNumber(p.lng));
  }

  // Medidas y distribución.
  put("floor_area", feedNumber(p.builtM2));
  put("plot_area", feedNumber(p.landM2));
  put("area_unit", "m2");
  put("rooms", p.bedrooms === null ? null : String(p.bedrooms));
  put("bathrooms", p.bathrooms === null ? null : String(p.bathrooms));
  put("half_bathrooms", p.halfBathrooms === null ? null : String(p.halfBathrooms));
  put("parking", p.parking === null ? null : String(p.parking));
  // 🔴 ageYears es la ANTIGÜEDAD, no el año de construcción. Mandarla tal
  // cual en <year_built> publicaría "año 12" y el portal ordena por ese
  // campo. Se convierte con el año de generateAt (el módulo sigue siendo
  // puro: la fecha entra por opciones, no se lee del reloj).
  put("age", p.ageYears === null ? null : String(p.ageYears));
  if (p.ageYears !== null) {
    const year = Number(String(options.generatedAt).slice(0, 4));
    if (Number.isFinite(year) && year > 1900) put("year_built", String(year - p.ageYears));
  }

  if (p.amenities.length > 0) {
    lines.push("      <features>");
    for (const key of p.amenities) {
      lines.push(`        <feature>${cdata(key)}</feature>`);
    }
    lines.push("      </features>");
  }

  const photos = p.photos.slice(0, Math.max(0, options.maxPhotos));
  if (photos.length > 0) {
    lines.push("      <pictures>");
    for (const photo of photos) {
      lines.push("        <picture>");
      lines.push(`          <picture_url>${cdata(photo.url)}</picture_url>`);
      lines.push("        </picture>");
    }
    lines.push("      </pictures>");
  }

  // 🔴 EL RECORRIDO VIRTUAL. Los portales tienen columna para él y es justo
  // donde más se nota: un inmueble con tour se ve mucho más que uno sin él.
  // Si no lo mandamos, se pierde exactamente ahí.
  const tour = p.tours[0];
  if (tour) {
    put("virtual_tour", tour.url);
    put("virtual_tour_type", tour.kind);
  }

  put("agency", account.name);
  put("agency_url", account.webUrl);
  put("contact_phone", account.phone);
  put("contact_email", account.email);
  put("date", p.updatedAt);

  lines.push("    </ad>");
  return lines.join("\n");
}

export const genericXmlAdapter: RealtyPortalAdapter = {
  key: "generic-xml",
  label: "Feed XML genérico",
  transport: "feed",
  contentType: "application/xml; charset=utf-8",
  filename: "propiedades.xml",

  build(properties, account, options): string {
    const ads = properties
      .map((p) => buildAd(p, account, options))
      .filter((s) => s !== "")
      .join("\n");

    // El documento se arma SIEMPRE, aunque no haya un solo inmueble: un feed
    // vacío y bien formado es una respuesta legítima ("hoy no hay nada
    // publicado"); un 500 o un XML a medias hace que el portal marque la
    // fuente como rota y a veces deje de intentar.
    const doc = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<trovit>",
      // Un comentario XML no admite "--" ni terminar en "-": una
      // inmobiliaria llamada "Casa--Hogar" rompería el documento entero.
      `  <!-- ${xmlComment(account.name)} · generado ${xmlComment(options.generatedAt)} · ${properties.length} inmuebles -->`,
      ads,
      "</trovit>",
    ].filter((line) => line !== "");
    return `${doc.join("\n")}\n`;
  },
};
