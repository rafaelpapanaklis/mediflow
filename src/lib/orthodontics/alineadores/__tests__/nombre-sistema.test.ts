/**
 * Alineadores — el primer campo del formulario tiene rótulo a la vista (H25).
 *
 * Run: npx tsx --test src/lib/orthodontics/alineadores/__tests__/nombre-sistema.test.ts
 *
 * Reproduce el hallazgo de la QA en vivo: el campo del sistema solo tenía un
 * texto de ejemplo, y quien probaba escribió «24» creyendo que era el total.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EJEMPLO_SISTEMA,
  ROTULO_SISTEMA,
  avisoNombreSistema,
  limpiarNombreSistema,
} from "../nombre-sistema";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const PANEL = readFileSync(
  join(RAIZ, "src/components/specialties/orthodontics/alineadores/AlineadoresPanel.tsx"),
  "utf8",
);

test("H25: «24» en el campo del sistema avisa de que eso es una cantidad", () => {
  const aviso = avisoNombreSistema("24");
  assert.ok(aviso, "hay aviso");
  assert.match(aviso!, /«24»/);
  assert.match(aviso!, /Total de alineadores/);
  assert.ok(avisoNombreSistema(" 24 "), "con espacios alrededor también");
  assert.ok(avisoNombreSistema("24.5"));
});

test("un nombre de verdad no avisa, aunque lleve cifras", () => {
  for (const nombre of ["Invisalign", "Spark", "3M Clarity", "Marca propia 2", "24 alineadores"]) {
    assert.equal(avisoNombreSistema(nombre), null, nombre);
  }
  assert.equal(avisoNombreSistema(""), null, "vacío: el campo es opcional");
  assert.equal(avisoNombreSistema("   "), null);
  assert.equal(avisoNombreSistema(null), null);
});

test("lo que se guarda va limpio, y vacío es null", () => {
  assert.equal(limpiarNombreSistema("  Invisalign   Lite "), "Invisalign Lite");
  assert.equal(limpiarNombreSistema(""), null);
  assert.equal(limpiarNombreSistema("   "), null);
  assert.equal(limpiarNombreSistema(undefined), null);
});

test("el formulario pinta el rótulo A LA VISTA y lo ata al campo", () => {
  // Un <label> con `htmlFor` y un <input> con el mismo `id`: el rótulo se ve y
  // además lo lee el lector de pantalla. Antes solo había `aria-label`.
  assert.match(PANEL, /<label htmlFor=\{idSistema\} className=\{orto\.campoEtiqueta\}>\s*\{ROTULO_SISTEMA\}\s*<\/label>/);
  assert.match(PANEL, /id=\{idSistema\}/);
  assert.match(PANEL, /placeholder=\{EJEMPLO_SISTEMA\}/);
  assert.doesNotMatch(PANEL, /aria-label="Sistema de alineadores"/, "el nombre lo da el rótulo visible");
  // Los demás campos también atan su rótulo (antes el <label> iba suelto).
  assert.match(PANEL, /<label htmlFor=\{id\} className=\{orto\.campoEtiqueta\}>\{label\}<\/label>/);
  assert.match(PANEL, /<label htmlFor=\{idInicio\} className=\{orto\.campoEtiqueta\}>/);
  // Y se guarda limpio.
  assert.match(PANEL, /systemName: limpiarNombreSistema\(form\.systemName\)/);
});

test("el rótulo no se puede confundir con una cantidad", () => {
  assert.match(ROTULO_SISTEMA, /Sistema/);
  assert.match(ROTULO_SISTEMA, /marca/);
  assert.doesNotMatch(ROTULO_SISTEMA, /total|cu[aá]ntos|n[uú]mero/i);
  assert.match(EJEMPLO_SISTEMA, /Invisalign/);
});
