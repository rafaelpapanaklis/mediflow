/* ═══════════════════════════════════════════════════════════════════════
   SOLO SE OFRECEN TRES PLANTILLAS: OFICIO, BARRIO Y REVISTA (ws6-t2, 16-nov).

     npx tsx --tsconfig tsconfig.test.json --test \
       "src/components/barber/templates/__tests__/ofrecidas.test.ts"

   Rafael: «solo quiero que haya estas 3». Las otras doce siguen
   REGISTRADAS (registro.test.ts las sigue exigiendo enteras: el motor no se
   rompe), pero la lista OFRECIDA —el selector de Mi web, sus miniaturas y
   la cuenta de la landing /barberias— son tres, en ese orden y sin «Nueva».
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BARBER_WEB_OFRECIDAS,
  BARBER_WEB_SELECTOR_LIST,
  BARBER_WEB_TEMPLATE_DEFAULT,
  BARBER_WEB_TEMPLATE_IDS,
  esPlantillaBarberWeb,
  esPlantillaOfrecidaBarberWeb,
} from "@/lib/barber/landing";
import { BARBER_WEB_TEMPLATE_COUNT } from "@/lib/barber/marketing";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_MANIFEST_LIST, BARBER_WEB_TEMPLATES } from "../index";

const SRC = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

test("se ofrecen SOLO Oficio, Barrio y Revista, en ese orden", () => {
  assert.deepEqual([...BARBER_WEB_OFRECIDAS], ["oficio", "barrio", "revista"]);
  assert.deepEqual(BARBER_WEB_SELECTOR_LIST.map((m) => m.id), ["oficio", "barrio", "revista"]);
  assert.deepEqual(BARBER_WEB_SELECTOR_LIST.map((m) => m.nombre), ["Oficio", "Barrio", "Revista"]);
});

test("el selector se arma DESPUÉS de los manifiestos y de sus bloques del final", () => {
  // BARBER_WEB_SELECTOR_LIST vive en landing.ts y se calcula al cargarla, cuando
  // manifest.ts ya corrió entero (manifiestos de las quince + los bloques que
  // mueven la tienda de oficio, barrio y revista). Son los MISMOS objetos, ya
  // con la tienda tras servicios: nada de copias tomadas a medias.
  for (const m of BARBER_WEB_SELECTOR_LIST) {
    assert.equal(m, BARBER_WEB_MANIFESTS[m.id], `${m.id}: el selector tiene otro objeto`);
    const ids = m.secciones.map((s) => s.id);
    assert.equal(ids.indexOf("tienda"), ids.indexOf("servicios") + 1, `${m.id}: la tienda no va tras servicios`);
    assert.equal(ids.filter((x) => x === "tienda").length, 1, `${m.id}: tienda repetida`);
  }
  const landing = leer("lib/barber/landing.ts");
  assert.match(landing, /export const BARBER_WEB_SELECTOR_LIST = BARBER_WEB_OFRECIDAS\.map\(\(id\) => BARBER_WEB_MANIFESTS\[id\]\)/);
  assert.doesNotMatch(leer("components/barber/templates/manifest.ts"), /export const BARBER_WEB_(SELECTOR_LIST|NUEVAS)\b/);
});

test("la de por defecto es una de las ofrecidas (Oficio)", () => {
  assert.equal(BARBER_WEB_TEMPLATE_DEFAULT, "oficio");
  assert.ok(esPlantillaOfrecidaBarberWeb(BARBER_WEB_TEMPLATE_DEFAULT));
});

test("las doce viejas siguen registradas (motor intacto) pero NO se ofrecen", () => {
  const viejas = BARBER_WEB_TEMPLATE_IDS.filter((id) => !(BARBER_WEB_OFRECIDAS as readonly string[]).includes(id));
  assert.equal(viejas.length, 12);
  for (const id of viejas) {
    assert.ok(esPlantillaBarberWeb(id), `${id} dejó de estar registrada`);
    assert.equal(typeof BARBER_WEB_TEMPLATES[id], "function", `${id} perdió su componente`);
    assert.ok(BARBER_WEB_MANIFEST_LIST.some((m) => m.id === id), `${id} perdió su manifiesto en la lista del motor`);
    assert.ok(!esPlantillaOfrecidaBarberWeb(id), `${id} se sigue ofreciendo`);
  }
  assert.ok(!esPlantillaOfrecidaBarberWeb("no-existe"));
  assert.ok(!esPlantillaOfrecidaBarberWeb(null));
});

test("el selector del editor (y sus miniaturas) pinta la lista ofrecida, sin «Nueva»", () => {
  const editor = leer("components/barber/landing/editor.tsx");
  assert.match(editor, /BARBER_WEB_SELECTOR_LIST\.map\(/);
  assert.doesNotMatch(editor, /BARBER_WEB_MANIFEST_LIST/, "el editor volvió a la lista con las quince");
  assert.doesNotMatch(editor, /plantillaNueva|\.nueva\b/, "sigue la etiqueta «Nueva»");
  // Las miniaturas salen del MISMO map: no hay otra lista que monte plantillas.
  assert.equal((editor.match(/<MiniaturaPlantilla /g) ?? []).length, 1);
  for (const idioma of ["es", "en"]) {
    const dicc = JSON.parse(leer(`i18n/dictionaries/barber/web.${idioma}.json`));
    assert.equal(dicc.plantillaNueva, undefined, `queda plantillaNueva en ${idioma}`);
  }
});

test("la landing /barberias anuncia las que se ofrecen (3), no las registradas (15)", () => {
  assert.equal(BARBER_WEB_TEMPLATE_COUNT, 3);
});
