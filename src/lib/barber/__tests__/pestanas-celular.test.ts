/* ═══════════════════════════════════════════════════════════════════════
   BARBEROS / EQUIPO / SUCURSALES / SOPORTE Y CLIENTES: ninguna pestaña se
   queda escondida tras un scroll lateral sin pista.

     npx tsx --test src/lib/barber/__tests__/pestanas-celular.test.ts

   Pulido · punto 4 (M12 de la revisión de ws6-t3). Las pestañas bajan a otro
   renglón (flex-wrap). Estática: la prueba de verdad fue verlas a 390 px.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const raiz = path.resolve(__dirname, "../../../components/barber");

for (const [nombre, rel] of [
  ["administración (Barberos/Equipo/Sucursales/Soporte)", "team/admin.module.css"],
  ["clientes", "clients/clients.module.css"],
] as const) {
  test(`${nombre}: las pestañas bajan de renglón y no usan scroll lateral`, () => {
    const css = readFileSync(path.join(raiz, rel), "utf8");
    const i = css.indexOf("\n.tabs {");
    assert.ok(i >= 0, "no encuentro .tabs");
    const cuerpo = css.slice(i, css.indexOf("}", i));
    assert.match(cuerpo, /flex-wrap:\s*wrap/);
    assert.doesNotMatch(cuerpo, /overflow-x:\s*auto/);
  });
}
