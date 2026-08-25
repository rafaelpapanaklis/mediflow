/* ═══════════════════════════════════════════════════════════════════════
   PRUEBAS DEL SEO DEL VERTICAL BARBER.

   Sin base de datos y sin navegador: @/lib/barber/seo es puro a
   propósito, y la regla que más importa —"una barbería que apagó su
   página no aparece en el sitemap"— se puede demostrar aquí en medio
   segundo en vez de a ojo contra Supabase.

   Correr:  npx tsx --test src/lib/barber/__tests__/seo.test.ts

   ── CADA CASO PRUEBA TAMBIÉN EL CAMINO INVERSO ────────────────────
   Un test que solo comprueba "la apagada no salió" lo pasa igual una
   función que no devuelva NADA. Por eso, junto a cada exclusión va su
   gemelo que sí debe aparecer.
   ═══════════════════════════════════════════════════════════════════════ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_COMPARAR_PATH,
  BARBER_COMPARATIVA_SLUGS,
  BARBER_LANDING_PATH,
  BARBER_RUTAS_NO_INDEXADAS,
  barberComparativaLd,
  barberStaticSitemapPaths,
  barberiasIndexables,
  rutaSitemapBarberia,
  type BarberShopSeoRow,
} from "@/lib/barber/seo";
import { serializeBarberJsonLd } from "@/lib/barber/marketing";
import { COMPETIDOR_SLUGS } from "@/lib/barber/comparativas";

const FECHA_SHOP = new Date("2026-01-10T00:00:00.000Z");
const FECHA_PUB = new Date("2026-03-20T00:00:00.000Z");
const FECHA_UPD = new Date("2026-04-01T00:00:00.000Z");

function shop(id: string, slug: string): BarberShopSeoRow {
  return { id, slug, updatedAt: FECHA_SHOP };
}

/* ── La regla central: apagada = fuera ───────────────────────────────── */

test("la barbería que apagó su página NO entra al sitemap", () => {
  const entradas = barberiasIndexables(
    [shop("s1", "fade-centro"), shop("s2", "la-navaja")],
    new Set(["s2"]),
  );

  const rutas = entradas.map((e) => e.path);
  assert.deepEqual(rutas, ["/b/fade-centro"]);
  assert.ok(!rutas.includes("/b/la-navaja"), "la apagada no puede aparecer");
});

test("el gemelo: sin apagar, esa MISMA barbería sí entra", () => {
  // Si este no pasara, el test de arriba lo pasaría una función rota que
  // no devuelve nada nunca.
  const entradas = barberiasIndexables(
    [shop("s1", "fade-centro"), shop("s2", "la-navaja")],
    new Set(),
  );
  assert.deepEqual(entradas.map((e) => e.path), ["/b/fade-centro", "/b/la-navaja"]);
});

test("sin fila de configuración (plan Básico) la página SÍ entra", () => {
  // Una barbería del plan Básico no tiene editor, así que nunca tendrá
  // fila en barber_landing_configs. Su página existe igual: exigir
  // `publishedAt` habría borrado del sitemap al grueso del padrón.
  const entradas = barberiasIndexables([shop("s1", "basica")], new Set(), []);
  assert.equal(entradas.length, 1);
  assert.equal(entradas[0].path, "/b/basica");
  assert.equal(entradas[0].lastModified.getTime(), FECHA_SHOP.getTime());
});

test("un slug vacío o en blanco no produce la URL /b/", () => {
  const entradas = barberiasIndexables(
    [shop("s1", "   "), shop("s2", ""), shop("s3", "buena")],
    new Set(),
  );
  assert.deepEqual(entradas.map((e) => e.path), ["/b/buena"]);
});

test("dos filas con el mismo slug producen UNA sola entrada", () => {
  const entradas = barberiasIndexables([shop("s1", "repe"), shop("s2", "repe")], new Set());
  assert.equal(entradas.length, 1);
});

/* ── lastModified ────────────────────────────────────────────────────── */

test("lastModified usa publishedAt cuando lo hay", () => {
  const entradas = barberiasIndexables([shop("s1", "x")], new Set(), [
    { barbershopId: "s1", publishedAt: FECHA_PUB, updatedAt: FECHA_UPD },
  ]);
  assert.equal(entradas[0].lastModified.getTime(), FECHA_PUB.getTime());
});

test("sin publicar, lastModified cae al updatedAt de la configuración", () => {
  const entradas = barberiasIndexables([shop("s1", "x")], new Set(), [
    { barbershopId: "s1", publishedAt: null, updatedAt: FECHA_UPD },
  ]);
  assert.equal(entradas[0].lastModified.getTime(), FECHA_UPD.getTime());
});

test("un publishedAt corrupto no arrastra: se usa el updatedAt de la configuración", () => {
  const entradas = barberiasIndexables([shop("s1", "x")], new Set(), [
    { barbershopId: "s1", publishedAt: new Date("no-es-fecha"), updatedAt: FECHA_UPD },
  ]);
  assert.equal(entradas[0].lastModified.getTime(), FECHA_UPD.getTime());
});

test("con las DOS fechas corruptas cae al updatedAt de la barbería", () => {
  const entradas = barberiasIndexables([shop("s1", "x")], new Set(), [
    {
      barbershopId: "s1",
      publishedAt: new Date("no-es-fecha"),
      updatedAt: new Date("tampoco"),
    },
  ]);
  assert.equal(entradas[0].lastModified.getTime(), FECHA_SHOP.getTime());
  // Y nunca una fecha inválida en el XML: eso invalida el sitemap entero.
  assert.ok(!Number.isNaN(entradas[0].lastModified.getTime()));
});

/* ── Rutas estáticas ─────────────────────────────────────────────────── */

test("las rutas estáticas incluyen la landing y NADA que sea privado", () => {
  const rutas = barberStaticSitemapPaths().map((r) => r.path);
  assert.ok(rutas.includes(BARBER_LANDING_PATH));

  for (const r of rutas) {
    assert.ok(!r.includes("/mi-cuenta"), `${r} es el portal del cliente`);
    assert.ok(!r.includes("/reservar"), `${r} es el embudo de reserva`);
    assert.ok(!r.startsWith("/barber/"), `${r} es del panel`);
  }
});

test("las rutas estáticas son la landing, el índice y una por comparativa", () => {
  const rutas = barberStaticSitemapPaths().map((r) => r.path);

  assert.deepEqual(rutas, [
    BARBER_LANDING_PATH,
    BARBER_COMPARAR_PATH,
    ...COMPETIDOR_SLUGS.map((s) => `${BARBER_COMPARAR_PATH}/${s}`),
  ]);
});

test("el registro del sitemap ES la fuente de las páginas, no una copia", () => {
  // Ésta es la prueba que impide el 404 silencioso: si alguien añade un
  // competidor y el sitemap no se entera (o al revés), aquí se cae.
  // `/barberias/comparar/[competidor]` saca su generateStaticParams de
  // COMPETIDOR_SLUGS, así que las dos listas tienen que ser la MISMA.
  assert.deepEqual(Array.from(BARBER_COMPARATIVA_SLUGS), Array.from(COMPETIDOR_SLUGS));
  assert.ok(COMPETIDOR_SLUGS.length > 0, "sin competidores no hay comparativas que anunciar");
});

test("cada prioridad del sitemap está en el rango legal 0–1", () => {
  for (const r of barberStaticSitemapPaths()) {
    assert.ok(r.priority >= 0 && r.priority <= 1, `${r.path} → ${r.priority}`);
  }
});

test("la lista de rutas NO indexadas nombra las tres superficies privadas", () => {
  const patrones = BARBER_RUTAS_NO_INDEXADAS.map((r) => r.patron);
  assert.ok(patrones.includes("/b/[slug]/mi-cuenta"));
  assert.ok(patrones.includes("/barber/fila/[slug]"));
  assert.ok(patrones.includes("/b/[slug]/reservar"));
  // Y cada una explica por qué: una lista sin motivo se borra sola en la
  // siguiente ola.
  for (const r of BARBER_RUTAS_NO_INDEXADAS) {
    assert.ok(r.porque.length > 40, `${r.patron} sin justificación`);
  }
});

test("rutaSitemapBarberia arma /b/<slug>", () => {
  assert.equal(rutaSitemapBarberia("fade-centro"), "/b/fade-centro");
});

/* ── Datos estructurados de las comparativas ─────────────────────────── */

const MIGAS = [
  { name: "Barberías", path: BARBER_LANDING_PATH },
  { name: "Comparar", path: BARBER_COMPARAR_PATH },
  { name: "Booksy", path: `${BARBER_COMPARAR_PATH}/booksy` },
];

test("la comparativa es SoftwareApplication y JAMÁS un tipo de negocio", () => {
  const ld = barberComparativaLd({
    producto: "DaleControl Barber",
    descripcion: "Alternativa a Booksy en México.",
    path: `${BARBER_COMPARAR_PATH}/booksy`,
    precios: [199, 329, 749],
    migas: MIGAS,
  }) as Record<string, any>;

  assert.equal(ld["@graph"][0]["@type"], "SoftwareApplication");

  const texto = JSON.stringify(ld);
  for (const prohibido of [
    "MedicalBusiness",
    "MedicalClinic",
    "MedicalOrganization",
    "MedicalSpecialty",
    "Dentist",
    "Physician",
    // El negocio es la barbería; una comparativa habla del SOFTWARE.
    "HealthAndBeautyBusiness",
  ]) {
    assert.ok(!texto.includes(prohibido), `una comparativa no puede declararse ${prohibido}`);
  }
});

test("la oferta trae el rango real de precios en MXN", () => {
  const ld = barberComparativaLd({
    producto: "x",
    descripcion: "y",
    path: "/barberias/comparar/booksy",
    precios: [199, 329, 749],
    migas: MIGAS,
  }) as Record<string, any>;

  const offers = ld["@graph"][0].offers;
  assert.equal(offers["@type"], "AggregateOffer");
  assert.equal(offers.priceCurrency, "MXN");
  assert.equal(offers.lowPrice, "199.00");
  assert.equal(offers.highPrice, "749.00");
  assert.equal(offers.offerCount, 3);
});

test("sin precios NO se inventa una oferta (un 0 se leería como gratis)", () => {
  const ld = barberComparativaLd({
    producto: "x",
    descripcion: "y",
    path: "/barberias/comparar/booksy",
    precios: [],
    migas: MIGAS,
  }) as Record<string, any>;
  assert.equal(ld["@graph"][0].offers, undefined);

  // Y un precio corrupto tampoco cuela.
  const roto = barberComparativaLd({
    producto: "x",
    descripcion: "y",
    path: "/barberias/comparar/booksy",
    precios: [0, NaN, -5],
    migas: MIGAS,
  }) as Record<string, any>;
  assert.equal(roto["@graph"][0].offers, undefined);
});

test("las rutas del JSON-LD salen absolutas", () => {
  const ld = barberComparativaLd({
    producto: "x",
    descripcion: "y",
    path: "/barberias/comparar/booksy",
    precios: [199],
    migas: MIGAS,
  }) as Record<string, any>;

  assert.ok(String(ld["@graph"][0].url).startsWith("http"));
  assert.ok(String(ld["@graph"][0]["@id"]).startsWith("http"));
  for (const item of ld["@graph"][1].itemListElement) {
    assert.ok(String(item.item).startsWith("http"), String(item.item));
  }
});

test("las migas numeran desde 1 y en orden", () => {
  const ld = barberComparativaLd({
    producto: "x",
    descripcion: "y",
    path: "/barberias/comparar/booksy",
    precios: [199],
    migas: MIGAS,
  }) as Record<string, any>;

  const migas = ld["@graph"][1];
  assert.equal(migas["@type"], "BreadcrumbList");
  assert.deepEqual(
    migas.itemListElement.map((m: any) => m.position),
    [1, 2, 3],
  );
  assert.equal(migas.itemListElement[0].name, "Barberías");
  assert.equal(migas.itemListElement[2].name, "Booksy");
});

/* ── El escape del <script> ──────────────────────────────────────────── */

test("serializar escapa el cierre de script (no se puede salir de la etiqueta)", () => {
  // `serializeBarberJsonLd` es de la ola de landing y lo usan las cuatro
  // páginas de /barberias. Se prueba aquí porque es la red que impide que
  // un nombre de competidor con `</script>` ejecute lo que quiera en una
  // página pública y cacheada.
  const salida = serializeBarberJsonLd({
    "@type": "SoftwareApplication",
    name: "Booksy </script><script>alert(1)</script>",
  });

  assert.ok(!salida.includes("</script>"), "quedó un cierre de etiqueta literal");
  assert.ok(!salida.includes("<"), "quedó un < sin escapar");
  // Y sigue siendo JSON válido: el parser lo desescapa solo.
  assert.equal(JSON.parse(salida).name, "Booksy </script><script>alert(1)</script>");
});
