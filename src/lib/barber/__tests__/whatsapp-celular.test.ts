/* ═══════════════════════════════════════════════════════════════════════
   WHATSAPP EN CELULAR: las tarjetas se apilan y las pestañas no se esconden.

     npx tsx --test src/lib/barber/__tests__/whatsapp-celular.test.ts

   Pulido · punto 3 (M5 de la revisión de ws6-t3). Estática: la prueba de
   verdad fue ver la pantalla a 390 px (ver REPORTE-ws6-t6-pulido.md).
     · Un elemento NO resuelve su propio @container: «.cards { … }» dentro de
       un @container que mide a «.cards» nunca aplicaba. La regla tiene que
       actuar sobre los HIJOS («.cards > *»).
     · Las pestañas bajan de renglón (flex-wrap), no se esconden tras un
       scroll lateral sin pista.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(
  path.resolve(__dirname, "../../../components/barber/whatsapp/whatsapp.module.css"),
  "utf8",
);

/** El cuerpo del primer bloque «selector { … }» (sin anidar). */
function bloque(selector: string): string {
  const i = css.indexOf(`\n${selector} {`);
  assert.ok(i >= 0, `no encuentro ${selector}`);
  return css.slice(i, css.indexOf("}", i));
}

test("las tarjetas, la bandeja y las campañas se apilan por sus hijos (no por sí mismas)", () => {
  for (const clase of [".cards", ".inbox", ".campaignGrid"]) {
    assert.match(css, new RegExp(`@container \\(max-width: \\d+px\\) \\{\\s*\\${clase} > \\* \\{ grid-column: 1 / -1; \\}`), clase);
    // …y ya no queda la regla muerta que se medía a sí misma.
    assert.doesNotMatch(css, new RegExp(`@container[^{]*\\{\\s*\\${clase} \\{ grid-template-columns`), `${clase} regla muerta`);
  }
});

test("las pestañas de WhatsApp bajan de renglón en vez de esconderse", () => {
  const tabs = bloque(".tabs");
  assert.match(tabs, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(tabs, /overflow-x:\s*auto/);
});
