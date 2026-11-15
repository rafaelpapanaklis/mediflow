// PRODUCTOS EN EL MENÚ Y EN CAJA (ws6-t3, punto 3) — estática, sin base.
//
// Rafael (15-nov): «si en el menú no tenemos apartado de Productos entonces
// agrega uno, porque la barbería seguramente vende productos de cabello,
// barba, cremas». El apartado ya existía (Negocio → Productos) y la Caja ya
// vendía productos en el mismo ticket que un servicio; lo que faltaba era que
// una barbería nueva entendiera QUÉ dar de alta y DÓNDE: el estado vacío
// decía solo «Agrega el primero» y el selector de la Caja salía vacío sin
// pista.
//
// Aquí: cada t("…") literal de las pantallas tocadas resuelve en es Y en, y
// los textos nuevos dicen lo que tienen que decir.
//
//   npx tsx --test src/lib/barber/__tests__/productos-alta-textos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dictionary } from "@/i18n/t";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { BARBER_NAV_ITEMS } from "../types";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function resuelve(dict: Dictionary, key: string): unknown {
  return key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Dictionary)[p] : undefined), dict);
}

/** Llaves literales de t("…") / t('…') en un archivo. */
function llaves(src: string): string[] {
  return Array.from(src.matchAll(/\bt\(\s*["']([a-zA-Z0-9_.-]+)["']/g), (m) => m[1]);
}

const CASOS: Array<{ archivo: string; raiz: (d: Dictionary) => Dictionary }> = [
  // caja/productos reciben el sub-árbol barber.caja (convención B)
  { archivo: "components/barber/products/productos-client.tsx", raiz: (d) => (d.barber as Dictionary).caja as Dictionary },
  { archivo: "components/barber/cash/ticket-modal.tsx", raiz: (d) => (d.barber as Dictionary).caja as Dictionary },
  // membresías usan el diccionario completo (llaves barber.membresias.*)
  { archivo: "components/barber/memberships/plans-tab.tsx", raiz: (d) => d },
  // la barra de arriba la arma el layout con el diccionario completo
  { archivo: "app/barber/(panel)/layout.tsx", raiz: (d) => d },
];

for (const { archivo, raiz } of CASOS) {
  test(`${archivo}: cada t("…") resuelve en es y en`, () => {
    const keys = llaves(leer(archivo));
    assert.ok(keys.length > 0, "no encontré llaves");
    for (const locale of ["es", "en"] as const) {
      const d = raiz(getBarberDict(locale) as Dictionary);
      // Texto suelto o plural ({ one, other }): las dos formas resuelven.
      const faltan = keys.filter((k) => { const v = resuelve(d, k); return typeof v !== "string" && !(v && typeof v === "object" && "other" in (v as object)); });
      assert.deepEqual(faltan, [], `${locale}: faltan ${faltan.join(", ")}`);
    }
  });
}

test("Productos vive en el menú, sección Negocio, y lo ve quien puede ver el catálogo", () => {
  const item = BARBER_NAV_ITEMS.find((i) => i.key === "productos");
  assert.ok(item, "no hay apartado Productos en el menú");
  assert.equal(item!.section, "negocio");
  assert.equal(item!.href, "/barber/productos");
  assert.equal(item!.permission, "products.view");
});

test("el estado vacío dice qué dar de alta (cera, aceite, shampoo…) y que se cobra en Caja con el corte", () => {
  for (const locale of ["es", "en"] as const) {
    const p = (((getBarberDict(locale) as Dictionary).barber as Dictionary).caja as Dictionary).productos as Dictionary;
    const body = String(p.emptyBody);
    const ejemplos = locale === "es" ? ["Cera", "aceite", "shampoo"] : ["Wax", "oil", "shampoo"];
    for (const e of ejemplos) assert.ok(body.includes(e), `${locale}: falta «${e}»`);
    assert.match(body, locale === "es" ? /Caja/ : /Cash register/);
  }
  const vista = leer("components/barber/products/productos-client.tsx");
  assert.match(vista, /products\.length === 0/, "el estado vacío distingue «no hay ninguno» de «todos archivados»");
  assert.match(vista, /productos\.emptyReadOnly/, "Recepción ve un vacío que no le pide dar de alta");
});

test("en Caja, con el plan que trae productos y ninguno dado de alta, el ticket dice dónde se agregan", () => {
  const modal = leer("components/barber/cash/ticket-modal.tsx");
  assert.match(modal, /checkout\.products\.length === 0[\s\S]{0,120}ticket\.noProductsYet/);
  const es = (((getBarberDict("es") as Dictionary).barber as Dictionary).caja as Dictionary).ticket as Dictionary;
  assert.match(String(es.noProductsYet), /Productos/);
});
