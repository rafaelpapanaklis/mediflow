/* ═══════════════════════════════════════════════════════════════════════
   «MIS CITAS» EN EL PIE DE TODAS LAS PLANTILLAS (lógica L3, 15-nov).

     npx tsx --tsconfig tsconfig.test.json \
       "src/components/barber/templates/__tests__/mis-citas.test.tsx"

   El cliente que reservó la semana pasada no tenía cómo volver a SUS citas
   desde la página de la barbería: /mi-cuenta solo se ofrecía justo después
   de reservar. Con WhatsApp conectado (la entrada es por código) el pie
   enlaza a /b/<slug>/mi-cuenta; sin WhatsApp no se promete.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { BARBER_WEB_TEMPLATE_IDS, configBarberWebVacia, rutaCuentaBarberia } from "@/lib/barber/landing";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_TEMPLATES } from "../index";
import type { BarberWebData } from "../types";

function datos(tpl: string, cuentaUrl: string | null): BarberWebData {
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
    servicios: [],
    barberos: [],
    editando: false,
    cuentaUrl,
  };
}

for (const tpl of BARBER_WEB_TEMPLATE_IDS) {
  test(`${tpl}: con WhatsApp, el pie lleva a «Mis citas»`, () => {
    const html = renderToStaticMarkup(BARBER_WEB_TEMPLATES[tpl]({ data: datos(tpl, rutaCuentaBarberia("el-corte")) }));
    assert.ok(html.includes('href="/b/el-corte/mi-cuenta"'), `${tpl}: falta la liga a mi-cuenta`);
  });
  test(`${tpl}: sin WhatsApp, no promete «Mis citas»`, () => {
    const html = renderToStaticMarkup(BARBER_WEB_TEMPLATES[tpl]({ data: datos(tpl, null) }));
    assert.ok(!html.includes("/mi-cuenta"), `${tpl}: liga a mi-cuenta sin WhatsApp`);
  });
}
