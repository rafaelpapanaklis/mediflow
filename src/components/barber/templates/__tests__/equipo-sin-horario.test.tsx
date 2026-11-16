/* ═══════════════════════════════════════════════════════════════════════
   BARBERO SIN HORARIO: SALE EN EL EQUIPO, PERO SIN «RESERVAR»
   (lógica L3 ronda 2, D2).

     npx tsx --tsconfig tsconfig.test.json \
       "src/components/barber/templates/__tests__/equipo-sin-horario.test.tsx"

   Antes el botón llevaba a una reserva que decía «todavía no tiene horario
   en línea». Ahora el barbero se ve (es parte del equipo) y no se ofrece
   una cita que no se puede tomar.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { BARBER_WEB_TEMPLATE_IDS, configBarberWebVacia } from "@/lib/barber/landing";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_TEMPLATES } from "../index";
import type { BarberWebData } from "../types";

function datos(tpl: string): BarberWebData {
  return {
    shop: {
      id: "b1",
      name: "Barbería El Corte",
      slug: "el-corte",
      phone: null,
      address: null,
      city: "CDMX",
      state: "CDMX",
      logoUrl: null,
    },
    config: configBarberWebVacia(),
    manifest: BARBER_WEB_MANIFESTS[tpl as keyof typeof BARBER_WEB_MANIFESTS],
    servicios: [],
    barberos: [
      { id: "con_horario", nombre: "Luis Trabaja", apodo: null, fotoUrl: null, bio: null, sinHorario: false },
      { id: "sin_horario", nombre: "Toño Nuevo", apodo: null, fotoUrl: null, bio: null, sinHorario: true },
    ],
    editando: false,
  };
}

let conEquipo = 0;
for (const tpl of BARBER_WEB_TEMPLATE_IDS) {
  test(`${tpl}: el barbero sin horario no lleva «Reservar»`, () => {
    const html = renderToStaticMarkup(BARBER_WEB_TEMPLATES[tpl]({ data: datos(tpl) }));
    assert.ok(!html.includes("barbero=sin_horario"), `${tpl}: ofrece reservar con quien no tiene horario`);
    if (html.includes("barbero=con_horario")) {
      conEquipo++;
      assert.ok(html.includes("Toño Nuevo"), `${tpl}: el barbero sin horario desapareció del equipo`);
    }
  });
}

test("al menos las plantillas con equipo pintan el «Reservar» del que sí tiene horario", () => {
  assert.ok(conEquipo >= 10, `solo ${conEquipo} plantillas enlazan al barbero con horario`);
});
