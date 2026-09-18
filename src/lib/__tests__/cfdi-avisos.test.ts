/**
 * H-9 · El aviso «el CFDI SÍ se timbró, no lo vuelvas a timbrar» no se va solo.
 *
 * Run: npx tsx --test src/lib/__tests__/cfdi-avisos.test.ts
 *
 * Se prueba la lista (pura) y el CABLEADO leyendo el código fuente: los dos
 * formularios de timbrado tienen que pasar por la lista compartida, y la ruta
 * tiene que seguir emitiendo el código que la lista espera.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CFDI_TIMBRADO_SIN_GUARDAR, cfdiAvisoPersistente, cfdiImpideReintento } from "../cfdi-avisos";

const SRC = join(__dirname, "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const FORMULARIOS = [
  "components/dashboard/billing/invoice-detail-modal.tsx",
  "app/dashboard/billing/billing-client.tsx",
];

test("«timbrado sin guardar» va en el aviso que no desaparece solo", () => {
  assert.equal(cfdiAvisoPersistente(CFDI_TIMBRADO_SIN_GUARDAR), true);
  // Los dos que ya eran persistentes lo siguen siendo.
  assert.equal(cfdiAvisoPersistente("CFDI_TOTAL_MISMATCH"), true);
  assert.equal(cfdiAvisoPersistente("CFDI_LIVE_NOT_READY"), true);
  // Un error cualquiera sigue yendo al toast.
  assert.equal(cfdiAvisoPersistente("CFDI_UNPAID_PUE"), false);
  assert.equal(cfdiAvisoPersistente(undefined), false);
});

test("solo «ya timbrado» apaga el botón de timbrar", () => {
  assert.equal(cfdiImpideReintento(CFDI_TIMBRADO_SIN_GUARDAR), true);
  assert.equal(cfdiImpideReintento("CFDI_TOTAL_MISMATCH"), false);
  assert.equal(cfdiImpideReintento(null), false);
});

test("la ruta sigue emitiendo ese código, con el UUID", () => {
  const ruta = leer("app/api/cfdi/route.ts");
  assert.match(ruta, new RegExp(`code:\\s*"${CFDI_TIMBRADO_SIN_GUARDAR}"`));
  assert.match(ruta, /uuid:\s*hecho\.uuid/);
});

for (const rel of FORMULARIOS) {
  test(`${rel}: el aviso pasa por la lista compartida y apaga el botón`, () => {
    const texto = leer(rel);
    assert.match(texto, /if \(cfdiAvisoPersistente\(data\.code\)\) \{/, "decide con la lista compartida");
    assert.ok(!/data\.code === "CFDI_TOTAL_MISMATCH"/.test(texto), "no lleva una lista propia que se pueda quedar corta");
    assert.match(texto, /disabled=\{[^}]*cfdiImpideReintento\(cfdiBlockCode\)/, "el botón de timbrar se apaga");
    assert.match(texto, /cfdiImpideReintento\(data\.code\) && typeof data\.uuid === "string"/, "el UUID queda registrado en pantalla");
  });
}
