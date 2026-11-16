/* ═══════════════════════════════════════════════════════════════════════
   LA SECCIÓN «TIENDA» DE MI WEB, EN LAS DOCE PLANTILLAS (ws6-t1, 16-nov).

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/templates/__tests__/tienda-seccion.test.tsx"

   Rafael: «¿cómo desde aquí llegas a la tienda?». La tienda se controla
   desde Mi web → Secciones, como las demás:
     · encendida y con productos: «Tienda» en el menú (o junto a «Reservar»
       en la portada de las plantillas sin menú) y la sección con sus
       productos y «Ver toda la tienda»;
     · apagada: ni menú ni sección;
     · encendida sin productos: nada vacío en la página;
     · por omisión (config sin la clave): encendida;
     · en su lugar del orden cuando la barbería la mueve.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import {
  BARBER_WEB_TEMPLATE_IDS,
  configBarberWebVacia,
  normalizarConfigBarberWeb,
  ordenDeSecciones,
  type BarberWebConfig,
} from "@/lib/barber/landing";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_TEMPLATES } from "../index";
import type { BarberWebData, BarberWebProducto } from "../types";

const TIENDA = "/b/el-corte/tienda";
const POMADA: BarberWebProducto = {
  id: "p1",
  nombre: "QA-T1 Pomada",
  precio: 180,
  fotoUrl: null,
  categoria: "Cabello",
  url: `${TIENDA}/p1`,
  agotado: false,
};

function datos(tpl: string, opts: { productos?: BarberWebProducto[]; config?: BarberWebConfig } = {}): BarberWebData {
  const productos = opts.productos ?? [POMADA];
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
    config: opts.config ?? configBarberWebVacia(),
    manifest: BARBER_WEB_MANIFESTS[tpl as keyof typeof BARBER_WEB_MANIFESTS],
    servicios: [{ id: "s1", nombre: "Corte", descripcion: null, duracionMin: 30, precio: 200, categoria: null }],
    barberos: [],
    editando: false,
    productos,
    // Como la página pública: liga solo si hay productos.
    tiendaUrl: productos.length > 0 ? TIENDA : null,
  } as BarberWebData;
}

const pinta = (tpl: string, d: BarberWebData) => renderToStaticMarkup(BARBER_WEB_TEMPLATES[tpl as keyof typeof BARBER_WEB_TEMPLATES]({ data: d }));
const ligasATienda = (html: string) => (html.match(new RegExp(`href="${TIENDA}"`, "g")) ?? []).length;
const apagada = (): BarberWebConfig =>
  normalizarConfigBarberWeb({ secciones: { tienda: { visible: false } } });

test("las doce declaran la sección «Tienda», ocultable y que consume productos", () => {
  for (const tpl of BARBER_WEB_TEMPLATE_IDS) {
    const s = BARBER_WEB_MANIFESTS[tpl].secciones.find((x) => x.id === "tienda");
    assert.ok(s, `${tpl}: sin sección tienda`);
    assert.equal(s!.obligatoria, undefined, `${tpl}: la tienda se tiene que poder apagar`);
    assert.deepEqual(s!.consume, ["productos"]);
  }
});

test("«tienda» es del vocabulario: apagarla se guarda (no se descarta al normalizar)", () => {
  assert.equal(apagada().secciones.tienda?.visible, false);
});

for (const tpl of BARBER_WEB_TEMPLATE_IDS) {
  test(`${tpl}: encendida (por omisión) y con productos → «Tienda» arriba + sección + «Ver toda la tienda»`, () => {
    const html = pinta(tpl, datos(tpl));
    assert.ok(html.includes('id="tienda"'), `${tpl}: falta la sección`);
    assert.ok(html.includes("QA-T1 Pomada"), `${tpl}: falta el producto`);
    assert.ok(html.includes(`href="${TIENDA}/p1"`), `${tpl}: falta la liga al producto`);
    assert.ok(html.includes("Ver toda la tienda"), `${tpl}: falta «Ver toda la tienda»`);
    // Una en la sección («Ver toda la tienda») + al menos una arriba (menú/portada/barra).
    assert.ok(ligasATienda(html) >= 2, `${tpl}: «Tienda» no está en el menú/portada (${ligasATienda(html)} ligas)`);
    // «Tienda» aparece ANTES que la sección: está arriba, no solo abajo.
    const primera = html.indexOf(`href="${TIENDA}"`);
    assert.ok(primera < html.indexOf('id="tienda"') || tpl === "portafolio", `${tpl}: la liga «Tienda» no está arriba`);
  });

  test(`${tpl}: apagada en Mi web → ni menú ni sección`, () => {
    const html = pinta(tpl, datos(tpl, { config: apagada() }));
    assert.ok(!html.includes('id="tienda"'), `${tpl}: sale la sección apagada`);
    assert.equal(ligasATienda(html), 0, `${tpl}: sale «Tienda» con la sección apagada`);
    assert.ok(!html.includes("QA-T1 Pomada"));
  });

  test(`${tpl}: encendida pero sin productos visibles → nada vacío`, () => {
    const html = pinta(tpl, datos(tpl, { productos: [] }));
    assert.ok(!html.includes('id="tienda"'), `${tpl}: sección vacía`);
    assert.ok(!html.includes("/tienda"), `${tpl}: liga a una tienda vacía`);
    assert.ok(!html.includes("Ver toda la tienda"));
  });
}

test("clásica: «Tienda» va en el menú justo después de Servicios", () => {
  const html = pinta("clasica", datos("clasica"));
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  const iServ = nav.indexOf('href="#servicios"');
  const iTienda = nav.indexOf(`href="${TIENDA}"`);
  assert.ok(iServ >= 0 && iTienda > iServ, "Tienda no está tras Servicios en el menú");
  const siguiente = nav.indexOf("<a", iServ + 1);
  assert.equal(siguiente, nav.lastIndexOf("<a", iTienda), "hay otra liga entre Servicios y Tienda");
  // Y en el teléfono (el menú se esconde) queda la liga de la barra.
  assert.ok(html.includes('class="dcbw-barra-tienda"'));
});

test("el orden manda: la tienda subida antes de servicios se pinta antes", () => {
  const m = BARBER_WEB_MANIFESTS.clasica;
  const orden = ordenDeSecciones(m, configBarberWebVacia()).filter((id) => id !== "tienda");
  orden.splice(orden.indexOf("servicios"), 0, "tienda");
  const config = normalizarConfigBarberWeb({ orden: { clasica: orden } });
  const html = pinta("clasica", datos("clasica", { config }));
  assert.ok(html.indexOf('id="tienda"') < html.indexOf('id="servicios"'), "no respetó el orden");
});

test("los textos de la sección se reescriben desde Mi web", () => {
  const config = normalizarConfigBarberWeb({
    secciones: { tienda: { visible: true, titulo: "Lo que usamos" } },
    copia: { "tienda.cta": "Todo lo de la tienda", "tienda.menu": "Productos" },
  });
  const html = pinta("clasica", datos("clasica", { config }));
  assert.ok(html.includes("Lo que usamos"));
  assert.ok(html.includes("Todo lo de la tienda"));
  assert.ok(html.includes(`<a href="${TIENDA}">Productos</a>`));
});
