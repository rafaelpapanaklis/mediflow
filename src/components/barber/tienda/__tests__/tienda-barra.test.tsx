/* ═══════════════════════════════════════════════════════════════════════
   TIENDA: VOLVER A LA BARBERÍA Y RESERVAR, SIEMPRE A LA VISTA (ws6-t1, 16-nov).
   Y LA NOTA DE LA SECCIÓN «TIENDA» EN MI WEB.

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/tienda/__tests__/tienda-barra.test.tsx"
   ═══════════════════════════════════════════════════════════════════════ */

import "../../templates/__tests__/_sin-css";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { TiendaShell } from "../tienda-shell";
import { NotaTienda } from "../../landing/controles";
import type { TiendaShop } from "@/lib/barber/tienda";

const shop = (locale: string): TiendaShop => ({
  id: "b1",
  name: "Barbería El Corte",
  slug: "el-corte",
  branchName: null,
  address: null,
  city: "CDMX",
  phone: null,
  logoUrl: null,
  locale,
  timezone: "America/Mexico_City",
});

test("la barra de la tienda: «← Volver a <barbería>» y «Reservar cita», pegada arriba", () => {
  const html = renderToStaticMarkup(<TiendaShell shop={shop("es")}><p>contenido</p></TiendaShell>);
  assert.ok(html.includes('class="dct-barra"'), "falta la barra");
  assert.ok(html.includes('href="/b/el-corte"'), "falta volver a la página");
  assert.ok(html.includes("Volver a Barbería El Corte"));
  assert.ok(html.includes('href="/b/el-corte/reservar"'), "falta reservar");
  assert.ok(html.includes("Reservar cita"));
  // La barra va ANTES del contenido (se ve sin bajar).
  assert.ok(html.indexOf("dct-barra") < html.indexOf("contenido"));
});

test("en inglés", () => {
  const html = renderToStaticMarkup(<TiendaShell shop={shop("en")}><p /></TiendaShell>);
  assert.ok(html.includes("Back to Barbería El Corte"));
  assert.ok(html.includes("Book an appointment"));
});

test("tienda inexistente: sin barra (no hay a dónde volver)", () => {
  const html = renderToStaticMarkup(<TiendaShell shop={null}><p /></TiendaShell>);
  assert.ok(!html.includes("dct-barra"));
});

const t = (k: string, v?: Record<string, string | number>) => (v?.count !== undefined ? `${k}=${v.count}` : k);

test("Mi web · con productos: cuántos, «Ver tienda» y «Elegir productos»", () => {
  const html = renderToStaticMarkup(<NotaTienda t={t} total={3} url="/b/el-corte/tienda" visible />);
  assert.ok(html.includes("tiendaVisibles=3"));
  assert.ok(html.includes('href="/b/el-corte/tienda"'));
  assert.ok(html.includes('href="/barber/productos"'));
});

test("Mi web · encendida sin productos: el aviso con el camino a Productos", () => {
  const html = renderToStaticMarkup(<NotaTienda t={t} total={0} url="/b/el-corte/tienda" visible />);
  assert.ok(html.includes("tiendaSinProductos"));
  assert.ok(html.includes('class="dcbwe-aviso"'), "encendida: aviso destacado");
  assert.ok(html.includes('href="/barber/productos"'));
  assert.ok(!html.includes("/b/el-corte/tienda"), "no manda a una tienda vacía");
});
