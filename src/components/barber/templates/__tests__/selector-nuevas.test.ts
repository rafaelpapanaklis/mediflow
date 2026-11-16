/* ═══════════════════════════════════════════════════════════════════════
   LAS NUEVAS VAN PRIMERO EN EL SELECTOR, CON «NUEVA» (ws6-t2).

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/templates/__tests__/selector-nuevas.test.ts"

   El selector de /barber/mi-web pinta BARBER_WEB_SELECTOR_LIST: las de
   BARBER_WEB_NUEVAS primero (en ese orden) y luego las demás en el orden de
   BARBER_WEB_MANIFEST_LIST. Son las MISMAS plantillas: ninguna se pierde.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { BARBER_WEB_TEMPLATE_IDS } from "@/lib/barber/landing";
import { BARBER_WEB_MANIFEST_LIST } from "../index";
import { BARBER_WEB_NUEVAS, BARBER_WEB_SELECTOR_LIST } from "../manifest";

const existentes = BARBER_WEB_NUEVAS.filter((id) => (BARBER_WEB_TEMPLATE_IDS as readonly string[]).includes(id));

test("el selector tiene exactamente las mismas plantillas que la lista, sin repetir", () => {
  const ids = BARBER_WEB_SELECTOR_LIST.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), BARBER_WEB_MANIFEST_LIST.map((m) => m.id).sort());
});

test("las nuevas que existen van primero, en el orden declarado, y con `nueva`", () => {
  assert.ok(existentes.includes("oficio"));
  const primeras = BARBER_WEB_SELECTOR_LIST.slice(0, existentes.length);
  assert.deepEqual(primeras.map((m) => m.id), existentes);
  for (const m of primeras) assert.equal(m.nueva, true, `${m.id} sin «Nueva»`);
  for (const m of BARBER_WEB_SELECTOR_LIST.slice(existentes.length)) assert.ok(!m.nueva, `${m.id} marcada como nueva`);
});

test("las demás conservan el orden de siempre (Clásica primero de ellas)", () => {
  const resto = BARBER_WEB_SELECTOR_LIST.slice(existentes.length).map((m) => m.id);
  const esperado = BARBER_WEB_MANIFEST_LIST.map((m) => m.id).filter((id) => !existentes.includes(id));
  assert.deepEqual(resto, esperado);
  assert.equal(resto[0], "clasica");
});

test("el editor pinta la lista del selector y la etiqueta «Nueva» (es y en)", () => {
  const raiz = path.resolve(__dirname, "../../../..");
  const editor = readFileSync(path.join(raiz, "components/barber/landing/editor.tsx"), "utf8");
  assert.match(editor, /BARBER_WEB_SELECTOR_LIST\.map\(/);
  assert.doesNotMatch(editor, /BARBER_WEB_MANIFEST_LIST\.map\(/, "el editor volvió a la lista sin las nuevas arriba");
  assert.match(editor, /m\.nueva \? <span[^>]*>\{t\("plantillaNueva"\)\}/);
  for (const idioma of ["es", "en"]) {
    const dicc = JSON.parse(readFileSync(path.join(raiz, `i18n/dictionaries/barber/web.${idioma}.json`), "utf8"));
    assert.ok(typeof dicc.plantillaNueva === "string" && dicc.plantillaNueva.trim(), `falta plantillaNueva en ${idioma}`);
  }
});
