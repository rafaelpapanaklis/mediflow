/* ═══════════════════════════════════════════════════════════════════════
   EL «RESERVAR» DE CADA SERVICIO LLEVA ESE SERVICIO YA ELEGIDO.

     npx tsx --tsconfig tsconfig.test.json \
       "src/components/barber/templates/__tests__/reservar-servicio.test.tsx"

   M13 de la auditoría del 14-nov. Se pinta el registro REAL de plantillas
   con dos servicios y se exige que cada renglón enlace a
   /b/<slug>/reservar?servicio=<id>. Minimal, Club y Premium no listan
   servicios con su propio «Reservar»: ahí solo se exige que no se rompa.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { BARBER_WEB_TEMPLATE_IDS, configBarberWebVacia } from "@/lib/barber/landing";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_TEMPLATES } from "../index";
import type { BarberWebData } from "../types";

/** Plantillas cuyos renglones de servicio traen su propio «Reservar». */
const CON_RESERVAR_POR_SERVICIO = [
  "clasica",
  "equipo",
  "portafolio",
  "urbana",
  "vintage",
  "precios",
  "estudio",
  "carta",
  "nocturna",
];

function datos(tpl: string): BarberWebData {
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
    servicios: [
      { id: "svc_uno", nombre: "Corte clásico", descripcion: null, duracionMin: 30, precio: 200, categoria: "general" },
      { id: "svc_dos", nombre: "Barba", descripcion: null, duracionMin: 20, precio: 150, categoria: "barba" },
    ],
    barberos: [],
    editando: false,
  };
}

for (const tpl of BARBER_WEB_TEMPLATE_IDS) {
  test(`${tpl}: pinta sin romperse`, () => {
    const html = renderToStaticMarkup(BARBER_WEB_TEMPLATES[tpl]({ data: datos(tpl) }));
    assert.ok(html.length > 0);
  });
}

for (const tpl of CON_RESERVAR_POR_SERVICIO) {
  test(`${tpl}: cada servicio enlaza a la reserva con ese servicio elegido`, () => {
    const html = renderToStaticMarkup(BARBER_WEB_TEMPLATES[tpl as keyof typeof BARBER_WEB_TEMPLATES]({ data: datos(tpl) }));
    assert.ok(html.includes("/b/el-corte/reservar?servicio=svc_uno"), `${tpl}: falta el enlace del primer servicio`);
    assert.ok(html.includes("/b/el-corte/reservar?servicio=svc_dos"), `${tpl}: falta el enlace del segundo servicio`);
  });
}
