/* ═══════════════════════════════════════════════════════════════════════
   «MI TARJETA» EN EL MENÚ DE LAS TRES PLANTILLAS (ws6-t2).

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/templates/__tests__/mi-tarjeta.test.tsx"

   Con estrellas encendidas la página lleva a /b/<slug>/mi-tarjeta desde el
   menú y desde el pie; sin estrellas, ni rastro. La liga es fija: jamás
   lleva un token ni un dato del cliente (la página se cachea para todos).
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { BARBER_WEB_OFRECIDAS, configBarberWebVacia, rutaCuentaBarberia } from "@/lib/barber/landing";
import { rutaMiTarjeta } from "@/lib/barber/tarjeta-web-core";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_TEMPLATES } from "../index";
import { TEXTO_MI_TARJETA, enlaceTarjeta } from "../pieces";
import type { BarberWebData } from "../types";

function datos(tpl: string, extra: Partial<BarberWebData> = {}): BarberWebData {
  return {
    shop: {
      id: "b1",
      name: "Barbería El Corte",
      slug: "el-corte",
      phone: "+52 55 1111 2222",
      address: "Av. Juárez 10",
      city: "CDMX",
      state: "CDMX",
      logoUrl: null,
    },
    config: configBarberWebVacia(),
    manifest: BARBER_WEB_MANIFESTS[tpl as keyof typeof BARBER_WEB_MANIFESTS],
    servicios: [{ id: "s1", nombre: "Corte", descripcion: null, duracionMin: 30, precio: 180, categoria: "Corte" }],
    barberos: [],
    editando: false,
    ...extra,
  };
}

const RUTA = rutaMiTarjeta("el-corte");
const pintar = (tpl: string, extra: Partial<BarberWebData> = {}) =>
  renderToStaticMarkup(BARBER_WEB_TEMPLATES[tpl as keyof typeof BARBER_WEB_TEMPLATES]({ data: datos(tpl, extra) }));
const ligas = (html: string) => html.split(`href="${RUTA}"`).length - 1;

test("las tres que se ofrecen son las que llevan «Mi tarjeta»", () => {
  assert.deepEqual([...BARBER_WEB_OFRECIDAS].sort(), ["barrio", "oficio", "revista"]);
});

test("la pieza: sin liga no hay nada; el rótulo es fijo", () => {
  assert.equal(enlaceTarjeta(datos("oficio")), null);
  assert.equal(enlaceTarjeta(datos("oficio", { tarjetaUrl: null })), null);
  assert.equal(enlaceTarjeta(datos("oficio", { tarjetaUrl: RUTA })), RUTA);
  assert.equal(TEXTO_MI_TARJETA, "Mi tarjeta");
});

for (const tpl of BARBER_WEB_OFRECIDAS) {
  test(`${tpl}: con estrellas, «Mi tarjeta» está en el menú y en el pie`, () => {
    const html = pintar(tpl, { tarjetaUrl: RUTA });
    assert.ok(ligas(html) >= 2, `esperaba menú + pie, hay ${ligas(html)}`);
    const menu = html.match(/<nav[^>]*aria-label="Secciones"[\s\S]*?<\/nav>/)?.[0] ?? "";
    assert.ok(menu.includes(`href="${RUTA}"`), "la liga va dentro del menú de secciones");
    assert.ok(menu.includes(TEXTO_MI_TARJETA));
    const pie = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
    assert.ok(pie.includes(`href="${RUTA}"`), "y en el pie");
  });

  test(`${tpl}: sin estrellas, ni liga ni rótulo`, () => {
    const html = pintar(tpl);
    assert.equal(ligas(html), 0);
    assert.ok(!html.includes(TEXTO_MI_TARJETA));
  });

  test(`${tpl}: convive con «Mis citas» y con la Tienda sin quitarles nada`, () => {
    const cuenta = rutaCuentaBarberia("el-corte");
    const html = pintar(tpl, { tarjetaUrl: RUTA, cuentaUrl: cuenta });
    assert.ok(html.includes(`href="${cuenta}"`));
    assert.ok(ligas(html) >= 2);
  });

  test(`${tpl}: la liga es fija, sin token ni datos del cliente`, () => {
    const html = pintar(tpl, { tarjetaUrl: RUTA });
    assert.ok(!/\/tarjeta\/[A-Za-z0-9_-]+\./.test(html), "ningún enlace personal en una página cacheada");
  });
}
