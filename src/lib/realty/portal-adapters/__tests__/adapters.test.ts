// ═══════════════════════════════════════════════════════════════════════
// Los adaptadores de portal y la política de entrega.
//
// Todo PURO: sin Postgres, sin sesión, sin red. Corre en un segundo.
//
//   npx tsx --test src/lib/realty/portal-adapters/__tests__/adapters.test.ts
//
// (No hay script npm a propósito: package.json está fuera del vertical y la
// guardia da exit 1 si se toca. Los verticales corren npx tsx --test a pelo.)
//
// Lo que se prueba y por qué:
//   · Que el XML sea PARSEABLE de verdad — se parsea con xmlbuilder2, que ya
//     es dependencia del repo. Un feed que "se ve bien" pero no parsea es
//     exactamente el fallo que un portal reporta como "tu fuente falla" sin
//     decir dónde.
//   · Que un texto con "]]>" o con caracteres de control NO parta el
//     documento. Es lo que llega pegado desde Word y desde WhatsApp.
//   · Que lo que el modelo canónico trae en null NO aparezca en la salida:
//     es la reja de privacidad vista desde el otro lado.
//   · Que la marca de reintento se pueda escribir y volver a leer sin
//     perder el contador ni ensuciar el mensaje del asesor.
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { create } from "xmlbuilder2";
import { genericXmlAdapter } from "@/lib/realty/portal-adapters/generic-xml";
import { metaCatalogAdapter } from "@/lib/realty/portal-adapters/meta-catalog";
import {
  googleListingAdapter,
  realtyListingLd,
  serializeRealtyLd,
} from "@/lib/realty/portal-adapters/google-listing";
import {
  REALTY_PORTAL_DESTINATIONS,
  adapterForDestination,
  getRealtyPortalAdapter,
  REALTY_FEED_FILES,
} from "@/lib/realty/portal-adapters";
import {
  MAX_PORTAL_ATTEMPTS,
  composePortalError,
  nextAttemptFor,
  slotInfo,
  splitPortalError,
} from "@/lib/realty/portal-adapters/retry";
import {
  cdata,
  checkPublishable,
  flattenText,
  resolveFeedPrice,
  stripXmlControlChars,
  xmlEscape,
  type RealtyAdapterOptions,
  type RealtyPublishableProperty,
  type RealtyPublisherAccount,
} from "@/lib/realty/portal-adapters/types";

const CUENTA: RealtyPublisherAccount = {
  id: "acc_1",
  name: "Inmobiliaria Peña & Asociados",
  slug: "pena-asociados",
  phone: "+52 33 1234 5678",
  email: "hola@pena.mx",
  city: "Guadalajara",
  state: "Jalisco",
  logoUrl: null,
  webUrl: "https://www.dalecontrol.com/i/pena-asociados",
};

const OPCIONES: RealtyAdapterOptions = {
  maxPhotos: 20,
  generatedAt: "2026-08-25T12:00:00.000Z",
};

function inmueble(over: Partial<RealtyPublishableProperty> = {}): RealtyPublishableProperty {
  return {
    id: "prp_1",
    folio: "INM-7K3Q",
    kind: "CASA",
    operation: "VENTA",
    status: "DISPONIBLE",
    price: 4850000,
    currency: "MXN",
    salePrice: 4850000,
    rentPrice: null,
    maintenanceFee: null,
    landM2: 220,
    builtM2: 185.5,
    bedrooms: 3,
    bathrooms: 2,
    halfBathrooms: 1,
    parking: 2,
    ageYears: 12,
    amenities: ["alberca", "jardin"],
    title: "Casa en Providencia con jardín",
    description: "Casa de dos pisos, muy iluminada.",
    address: "Pablo Neruda 123",
    colonia: "Providencia",
    city: "Guadalajara",
    state: "Jalisco",
    zip: "44630",
    lat: 20.7042311,
    lng: -103.3812455,
    showExactAddress: true,
    photos: [
      { url: "https://cdn.test/1.webp", isCover: true, width: 1600, height: 1200 },
      { url: "https://cdn.test/2.webp", isCover: false, width: 1600, height: 1200 },
    ],
    tours: [
      { kind: "TOUR_3D", provider: "matterport", url: "https://my.matterport.com/show/?m=abc" },
    ],
    url: "https://www.dalecontrol.com/i/pena-asociados/casa-providencia",
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...over,
  };
}

/** Parsea de verdad: si el documento está roto, esto lanza. */
function parseXml(xml: string): Record<string, unknown> {
  return create(xml).end({ format: "object" }) as Record<string, unknown>;
}

/**
 * Texto de un nodo ya parseado. xmlbuilder2 devuelve el contenido de un nodo
 * pelado como string, el de UN CDATA como `{ $: "..." }` y el de VARIOS
 * CDATA consecutivos como `{ $1: "...", $2: "..." }` — que es justo lo que
 * produce partir un "]]>" en dos secciones. El helper las concatena para que
 * la prueba mire el DATO y no el detalle del parser.
 */
function txt(node: unknown): string {
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const partes = Object.keys(obj)
      .filter((k) => /^\$\d*$/.test(k))
      .sort((a, b) => (Number(a.slice(1)) || 0) - (Number(b.slice(1)) || 0))
      .map((k) => String(obj[k]));
    if (partes.length > 0) return partes.join("");
  }
  return String(node ?? "");
}

/** El `<ad>` (único) de un XML genérico ya parseado. */
function primerAd(xml: string): Record<string, unknown> {
  const doc = parseXml(xml) as { trovit?: { ad?: unknown } };
  assert.ok(doc.trovit, "falta la raíz <trovit>");
  const ad = doc.trovit.ad;
  assert.ok(ad, "no salió ningún <ad>");
  return (Array.isArray(ad) ? ad[0] : ad) as Record<string, unknown>;
}

// ── XML genérico ───────────────────────────────────────────────────────

test("el XML genérico es un documento parseable de verdad", () => {
  const ad = primerAd(genericXmlAdapter.build([inmueble()], CUENTA, OPCIONES));
  assert.equal(txt(ad.id), "prp_1");
  assert.equal(txt(ad.price), "4850000");
  assert.equal(txt(ad.currency), "MXN");
  assert.equal(txt(ad.city), "Guadalajara");
  assert.equal(txt(ad.url), "https://www.dalecontrol.com/i/pena-asociados/casa-providencia");
});

test("un feed VACÍO sigue siendo un documento válido (no un 500 ni un XML a medias)", () => {
  const xml = genericXmlAdapter.build([], CUENTA, OPCIONES);
  const doc = parseXml(xml) as { trovit: unknown };
  assert.ok("trovit" in doc);
});

test("el recorrido virtual SÍ sale: es el campo que más se pierde y donde más sirve", () => {
  const xml = genericXmlAdapter.build([inmueble()], CUENTA, OPCIONES);
  assert.ok(xml.includes("<virtual_tour>"), "no salió el recorrido");
  assert.ok(xml.includes("my.matterport.com"));
});

test("sin dirección exacta, el XML no lleva calle NI coordenadas", () => {
  // Es lo que produce feed.ts cuando showExactAddress está apagado: las
  // coordenadas con 7 decimales SON la dirección exacta.
  const xml = genericXmlAdapter.build(
    [inmueble({ address: null, lat: null, lng: null, showExactAddress: false })],
    CUENTA,
    OPCIONES,
  );
  assert.equal(xml.includes("<address>"), false, "se coló la calle");
  assert.equal(xml.includes("<latitude>"), false, "se colaron las coordenadas");
  assert.equal(xml.includes("<longitude>"), false, "se colaron las coordenadas");
  // La colonia y la ciudad SÍ: sin ellas el portal no puede filtrar nada.
  assert.ok(xml.includes("Providencia"));
  assert.ok(xml.includes("Guadalajara"));
});

test('una descripción con "]]>" no parte el documento', () => {
  const xml = genericXmlAdapter.build(
    [inmueble({ description: 'Mide 10m x 22m ]]> y tiene jardín <script>alert(1)</script>' })],
    CUENTA,
    OPCIONES,
  );
  const ad = primerAd(xml);
  // El texto original sobrevive ENTERO, incluido el "]]>" que habría cerrado
  // la sección antes de tiempo, y el <script> viaja como texto.
  assert.equal(
    txt(ad.content),
    'Mide 10m x 22m ]]> y tiene jardín <script>alert(1)</script>',
  );
});

test("los caracteres de control se van: un XML 1.0 no los admite ni escapados", () => {
  const sucio = "Casa\u0007\u000B con patio";
  assert.equal(stripXmlControlChars(sucio), "Casa con patio");
  const xml = genericXmlAdapter.build([inmueble({ title: sucio })], CUENTA, OPCIONES);
  assert.doesNotThrow(() => parseXml(xml));
});

test('un nombre de cuenta con "--" no rompe el comentario del encabezado', () => {
  const xml = genericXmlAdapter.build([], { ...CUENTA, name: "Casa--Hogar--" }, OPCIONES);
  assert.doesNotThrow(() => parseXml(xml), "el comentario XML se partió");
});

test("la antigüedad se convierte a año de construcción (no se manda tal cual)", () => {
  const ad = primerAd(genericXmlAdapter.build([inmueble({ ageYears: 12 })], CUENTA, OPCIONES));
  assert.equal(txt(ad.age), "12");
  assert.equal(txt(ad.year_built), "2014", "2026 − 12 = 2014");
});

test("maxPhotos recorta de verdad", () => {
  const fotos = Array.from({ length: 30 }, (_, i) => ({
    url: `https://cdn.test/${i}.webp`,
    isCover: i === 0,
    width: null,
    height: null,
  }));
  const xml = genericXmlAdapter.build([inmueble({ photos: fotos })], CUENTA, {
    ...OPCIONES,
    maxPhotos: 3,
  });
  assert.equal(xml.split("<picture_url>").length - 1, 3);
});

test("en RENTA el precio que sale es el de renta", () => {
  const xml = genericXmlAdapter.build(
    [inmueble({ operation: "RENTA", price: 18000, rentPrice: 18000, salePrice: null })],
    CUENTA,
    OPCIONES,
  );
  const ad = primerAd(xml);
  assert.equal(txt(ad.price), "18000");
  assert.equal(txt(ad.operation), "Renta");
});

// ── Catálogo de Meta ───────────────────────────────────────────────────

test("el CSV de Meta lleva encabezado y una fila por inmueble", () => {
  const csv = metaCatalogAdapter.build([inmueble(), inmueble({ id: "prp_2" })], CUENTA, OPCIONES);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3, "encabezado + 2 filas");
  assert.ok(lines[0].startsWith("home_listing_id,name,availability"));
  assert.ok(lines[1].startsWith("prp_1,"));
});

test("una coma en la descripción NO corre las columnas del CSV", () => {
  const csv = metaCatalogAdapter.build(
    [inmueble({ description: 'Amplia, luminosa y con "vista"' })],
    CUENTA,
    OPCIONES,
  );
  const fila = csv.trim().split("\r\n")[1];
  // La celda va entrecomillada y la comilla interna duplicada (RFC 4180).
  assert.ok(fila.includes('"Amplia, luminosa y con ""vista"""'), fila);
});

test("el catálogo vacío es el encabezado solo: Meta lo acepta y no marca la fuente rota", () => {
  const csv = metaCatalogAdapter.build([], CUENTA, OPCIONES);
  assert.equal(csv.trim().split("\r\n").length, 1);
});

test("la disponibilidad de Meta distingue venta, renta y vendido", () => {
  const venta = metaCatalogAdapter.build([inmueble()], CUENTA, OPCIONES);
  assert.ok(venta.includes(",for_sale,"));
  const renta = metaCatalogAdapter.build([inmueble({ operation: "RENTA" })], CUENTA, OPCIONES);
  assert.ok(renta.includes(",for_rent,"));
  // Marcar vendido NO es borrarlo del catálogo: es mandarlo como `sold`
  // para que Meta deje de gastarle presupuesto.
  const vendido = metaCatalogAdapter.build([inmueble({ status: "VENDIDO" })], CUENTA, OPCIONES);
  assert.ok(vendido.includes(",sold,"));
});

test("el precio de Meta va como monto y moneda en una sola celda", () => {
  const csv = metaCatalogAdapter.build([inmueble()], CUENTA, OPCIONES);
  assert.ok(csv.includes("4850000 MXN"));
});

// ── JSON-LD de la web propia ───────────────────────────────────────────

test("el JSON-LD es un RealEstateListing con oferta y metros en MTK", () => {
  const ld = realtyListingLd(inmueble(), CUENTA) as Record<string, never>;
  assert.equal(ld["@type"], "RealEstateListing");
  const about = ld.about as unknown as Record<string, unknown>;
  assert.equal(about["@type"], "SingleFamilyResidence");
  assert.equal(about.numberOfRooms, 3);
  assert.deepEqual(about.floorSize, {
    "@type": "QuantitativeValue",
    value: 185.5,
    unitCode: "MTK",
  });
  const offers = ld.offers as unknown as Record<string, unknown>;
  assert.equal(offers.price, 4850000);
  assert.equal(offers.priceCurrency, "MXN");
});

test("sin dirección exacta, el JSON-LD tampoco lleva calle ni geo", () => {
  const ld = realtyListingLd(
    inmueble({ address: null, lat: null, lng: null, showExactAddress: false }),
    CUENTA,
  ) as Record<string, never>;
  const about = ld.about as unknown as Record<string, unknown>;
  const address = about.address as Record<string, unknown>;
  assert.equal("streetAddress" in address, false, "se coló la calle en el marcado");
  assert.equal("geo" in about, false, "se colaron las coordenadas en el marcado");
  assert.equal(address.addressLocality, "Guadalajara");
});

test("una bodega NO se marca como vivienda (marcado falso penaliza más que no ponerlo)", () => {
  const ld = realtyListingLd(inmueble({ kind: "BODEGA" }), CUENTA) as Record<string, never>;
  assert.equal((ld.about as unknown as Record<string, unknown>)["@type"], "Place");
});

test("serializeRealtyLd escapa el menor-que: un título con </script> no parte la etiqueta", () => {
  const json = serializeRealtyLd({ name: "Casa </script><img onerror=x>" });
  assert.equal(json.includes("<"), false, json);
  assert.ok(json.includes("\\u003c"));
  assert.deepEqual(JSON.parse(json.replace(/\\u003c/g, "<")), {
    name: "Casa </script><img onerror=x>",
  });
});

test("el ItemList del adaptador de Google es JSON válido", () => {
  const out = googleListingAdapter.build([inmueble()], CUENTA, OPCIONES);
  const parsed = JSON.parse(out);
  assert.equal(parsed["@type"], "ItemList");
  assert.equal(parsed.numberOfItems, 1);
});

// ── Registro de adaptadores ────────────────────────────────────────────

test("cada destino apunta a un adaptador que existe", () => {
  const rotos = REALTY_PORTAL_DESTINATIONS.filter((d) => !getRealtyPortalAdapter(d.adapter));
  assert.deepEqual(rotos.map((d) => d.key), []);
});

test("las keys de destino son únicas (se guardan en la base: un choque pisa filas)", () => {
  const keys = REALTY_PORTAL_DESTINATIONS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("los tres grandes de México están, pero APAGADOS y con el motivo escrito", () => {
  for (const key of ["inmuebles24", "lamudi", "casasyterrenos"]) {
    const d = REALTY_PORTAL_DESTINATIONS.find((x) => x.key === key);
    assert.ok(d, `falta ${key} del catálogo`);
    assert.equal(d.available, false, `${key} no puede salir como disponible: no hay conexión`);
    assert.ok(d.unavailableReason && d.unavailableReason.length > 20, `${key} sin motivo`);
  }
});

test("la UI de Meta habla de anuncios, NUNCA de Marketplace", () => {
  const meta = REALTY_PORTAL_DESTINATIONS.find((d) => d.key === "meta");
  assert.ok(meta);
  assert.ok(/Facebook e Instagram/.test(meta.label));
  // Publicar propiedades en Marketplace desde una plataforma de terceros
  // está cerrado desde 2023. Prometerlo es un reclamo garantizado.
  assert.ok(/NO publica en Marketplace/.test(meta.help), meta.help);
});

test("un destino desconocido cae al XML genérico en vez de reventar", () => {
  assert.equal(adapterForDestination("portal-que-no-existe").key, "generic-xml");
});

test("los nombres de archivo del feed no chocan entre sí", () => {
  const files = Object.keys(REALTY_FEED_FILES);
  assert.equal(new Set(files).size, files.length);
  assert.ok(files.includes("propiedades.xml"));
  assert.ok(files.includes("meta.csv"));
});

// ── Política de entrega ────────────────────────────────────────────────

test("la marca de reintento se escribe y se vuelve a leer sin perder nada", () => {
  const cuando = new Date("2026-08-25T18:00:00.000Z");
  const guardado = composePortalError("El portal respondió 503.", 3, cuando);
  assert.ok(guardado);
  const leido = splitPortalError(guardado);
  assert.equal(leido.message, "El portal respondió 503.", "el asesor NO debe ver el corchete");
  assert.equal(leido.attempts, 3);
  assert.equal(leido.nextAttemptAt?.toISOString(), cuando.toISOString());
});

test("re-marcar un error que YA traía marca no la duplica ni congela el contador", () => {
  const t1 = new Date("2026-08-25T18:00:00.000Z");
  const t2 = new Date("2026-08-25T19:00:00.000Z");
  const uno = composePortalError("Falló.", 1, t1);
  const dos = composePortalError(uno, 2, t2);
  assert.equal((dos.match(/dc:reintento/g) ?? []).length, 1, "quedaron dos marcas");
  assert.equal(splitPortalError(dos).attempts, 2);
});

test("un error sin marca se lee limpio; sin error no hay nada que guardar", () => {
  assert.deepEqual(splitPortalError("Le faltan fotos."), {
    message: "Le faltan fotos.",
    attempts: 0,
    nextAttemptAt: null,
  });
  assert.equal(splitPortalError(null).message, null);
  assert.equal(splitPortalError("").message, null);
  assert.equal(composePortalError(null, 3, new Date()), null);
});

test("la espera CRECE y se rinde al llegar al tope", () => {
  const desde = new Date("2026-08-25T12:00:00.000Z");
  const esperas = [0, 1, 2, 3, 4].map((n) => {
    const next = nextAttemptFor(n, desde);
    return next ? (next.getTime() - desde.getTime()) / 60000 : null;
  });
  assert.deepEqual(esperas, [5, 15, 45, 135, 405]);
  assert.equal(nextAttemptFor(MAX_PORTAL_ATTEMPTS, desde), null, "debe rendirse");
  assert.equal(nextAttemptFor(MAX_PORTAL_ATTEMPTS + 5, desde), null);
});

test("cupo 0 significa SIN LÍMITE, no 'no puedes publicar'", () => {
  // maxListings nace en 0 (default de la columna): quiere decir "todavía no
  // me dijiste cuántos anuncios contrataste".
  const libre = slotInfo(0, 40);
  assert.equal(libre.unlimited, true);
  assert.equal(libre.full, false);
  assert.equal(libre.remaining, null);
});

test("el cupo se llena EXACTO en el número contratado", () => {
  assert.equal(slotInfo(10, 9).full, false);
  assert.equal(slotInfo(10, 9).remaining, 1);
  assert.equal(slotInfo(10, 10).full, true);
  assert.equal(slotInfo(10, 10).remaining, 0);
  // Si alguien BAJA el cupo después de haber elegido de más, no salen
  // negativos: quedan 0 y los sobrantes se marcan con error en la matriz.
  assert.equal(slotInfo(10, 14).remaining, 0);
  assert.equal(slotInfo(10, 14).full, true);
});

// ── El precio que se publica ───────────────────────────────────────────
// 🔴 La regla más peligrosa del módulo: publicar un precio de VENTA como
// renta MENSUAL se ve, se comparte y no hay forma de explicarlo.

test("una RENTA sin precio de renta NO hereda el precio de venta", () => {
  // Ficha capturada como VENTA en 4 850 000 y luego cambiada a RENTA sin
  // capturar la renta. Antes salía "$4,850,000 al mes".
  assert.deepEqual(resolveFeedPrice("RENTA", 4850000, null), {
    operation: "RENTA",
    price: 0,
  });
  // Precio 0 = bloqueo con motivo, y el bloqueo la deja fuera del feed.
  const check = checkPublishable(inmueble({ operation: "RENTA", price: 0 }));
  assert.ok(check.blockers.some((b) => b.includes("precio de renta")), check.blockers.join(" "));
});

test("una RENTA con su precio publica ESE precio", () => {
  assert.deepEqual(resolveFeedPrice("RENTA", 4850000, 18000), {
    operation: "RENTA",
    price: 18000,
  });
});

test("AMBAS con solo renta se anuncia como RENTA, no como venta en 0", () => {
  // `price` es NOT NULL con default 0, así que `??` nunca caía a rentPrice y
  // este inmueble salía con precio 0 (o sea, no salía).
  assert.deepEqual(resolveFeedPrice("AMBAS", 0, 18000), {
    operation: "RENTA",
    price: 18000,
  });
});

test("AMBAS con los dos precios anuncia la VENTA", () => {
  assert.deepEqual(resolveFeedPrice("AMBAS", 4850000, 18000), {
    operation: "AMBAS",
    price: 4850000,
  });
});

test("sin ningún precio el resultado es 0, y 0 no llega al feed", () => {
  assert.equal(resolveFeedPrice("AMBAS", 0, 0).price, 0);
  assert.equal(resolveFeedPrice("VENTA", 0, 18000).price, 0, "una VENTA no usa la renta");
  assert.equal(resolveFeedPrice("VENTA", -5, null).price, 0, "un negativo no es un precio");
  for (const op of ["VENTA", "RENTA", "AMBAS"] as const) {
    assert.ok(
      checkPublishable(inmueble({ operation: op, price: 0 })).blockers.length > 0,
      `${op} con precio 0 tendría que bloquearse`,
    );
  }
});

test("checkPublishable bloquea lo que el portal rechazaría y solo AVISA del resto", () => {
  // Bloqueos: sin título, sin precio, sin ubicación.
  assert.ok(checkPublishable(inmueble({ title: "Casa" })).blockers.length > 0);
  assert.ok(checkPublishable(inmueble({ city: null, colonia: null })).blockers.length > 0);
  // Avisos: sin fotos, sin descripción, sin m², sin recorrido. NO bloquean —
  // dejar un inmueble fuera del feed en silencio es peor que publicarlo sin
  // foto, y el asesor ve el aviso en la matriz.
  const flaco = checkPublishable(
    inmueble({ photos: [], tours: [], description: null, builtM2: null, landM2: null }),
  );
  assert.deepEqual(flaco.blockers, []);
  assert.equal(flaco.warnings.length, 4);
});

// ── Utilidades de texto ────────────────────────────────────────────────

test("xmlEscape cubre los cinco caracteres que rompen un XML", () => {
  assert.equal(xmlEscape(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;");
  assert.equal(xmlEscape(null), "");
});

test("cdata parte el cierre prematuro en dos secciones", () => {
  assert.equal(cdata("a]]>b"), "<![CDATA[a]]]]><![CDATA[>b]]>");
});

test("flattenText aplana saltos de línea y recorta con puntos suspensivos", () => {
  assert.equal(flattenText("hola\n\n  mundo"), "hola mundo");
  assert.equal(flattenText("abcdef", 4), "abc…");
  assert.equal(flattenText(null), "");
});
