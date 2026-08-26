/* ═══════════════════════════════════════════════════════════════════════
   NINGUNA PLANTILLA NACE A MEDIAS.

     npx tsx --tsconfig tsconfig.test.json \
       "src/components/barber/templates/__tests__/registro.test.ts"

   Agregar una plantilla son cinco pasos en cuatro archivos (ver la
   cabecera de ../manifest.ts): el id, el manifiesto, el componente, la
   línea del registro y la piel. Los tipos cazan tres de ellos (un id sin
   manifiesto o sin componente no compila), pero NO cazan los otros dos:

     · una plantilla que no está en BARBER_WEB_MANIFEST_LIST existe para el
       motor y es INVISIBLE en el selector del editor — nadie la puede elegir;
     · una plantilla sin su bloque `.dcbw-<id>` en skins.css se pinta con
       los neutros de la raíz: sale "en blanco", sin su piel, y parece rota.

   Esta prueba recorre BARBER_WEB_TEMPLATE_IDS y exige los cinco pasos para
   CADA id. Es estática: sin base, sin navegador, sin pintar nada.
   ═══════════════════════════════════════════════════════════════════════ */

import "./_sin-css"; // ← PRIMERO: ../index arrastra skins.css
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { BARBER_WEB_ACCENTS, BARBER_WEB_TEMPLATE_IDS } from "@/lib/barber/landing";
import { BARBER_WEB_MANIFESTS, BARBER_WEB_MANIFEST_LIST, BARBER_WEB_TEMPLATES } from "../index";

const CARPETA = path.resolve(__dirname, "..");
const SKINS = readFileSync(path.join(CARPETA, "skins.css"), "utf8");
const INDEX = readFileSync(path.join(CARPETA, "index.tsx"), "utf8");

test("cada id declarado tiene su manifiesto, y el manifiesto lleva su propio id", () => {
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const m = BARBER_WEB_MANIFESTS[id];
    assert.ok(m, `«${id}» está en BARBER_WEB_TEMPLATE_IDS pero no tiene manifiesto`);
    assert.equal(m.id, id, `el manifiesto guardado bajo «${id}» dice ser «${m.id}»`);
    assert.ok(m.nombre.trim(), `«${id}» no tiene nombre para el selector`);
    assert.ok(m.para.trim(), `«${id}» no dice para quién es`);
    assert.ok(m.estructura.trim(), `«${id}» no dice qué la hace distinta`);
    assert.ok(m.secciones.length >= 2, `«${id}» tiene menos de dos secciones`);
  }
  // Y al revés: ningún manifiesto huérfano de un id que ya no existe.
  assert.deepEqual(Object.keys(BARBER_WEB_MANIFESTS).sort(), [...BARBER_WEB_TEMPLATE_IDS].sort());
});

test("cada id aparece en la lista del selector del editor (BARBER_WEB_MANIFEST_LIST), una sola vez", () => {
  const enLista = BARBER_WEB_MANIFEST_LIST.map((m) => m.id);
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const veces = enLista.filter((x) => x === id).length;
    assert.equal(veces, 1, `«${id}» aparece ${veces} veces en BARBER_WEB_MANIFEST_LIST (el editor no la ofrece o la repite)`);
  }
  assert.equal(enLista.length, BARBER_WEB_TEMPLATE_IDS.length, "la lista del selector tiene ids que no están declarados");
});

test("cada id tiene componente registrado en index.tsx, y es un componente de verdad", () => {
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const C = BARBER_WEB_TEMPLATES[id];
    assert.equal(typeof C, "function", `«${id}» no tiene componente en BARBER_WEB_TEMPLATES`);
    // Cada plantilla vive en su propio archivo t-<id>.tsx y se importa de ahí:
    // es la convención que hace que dos personas puedan escribir dos
    // plantillas a la vez sin pisarse.
    assert.match(INDEX, new RegExp(`from\\s+["']\\./t-${id}["']`), `index.tsx no importa ./t-${id}`);
  }
});

test("cada id tiene su bloque de piel `.dcbw-<id>` en skins.css", () => {
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    // La regla raíz de la piel: `.dcbw-<id> {` o, si el id choca con una
    // pieza compartida (pasa con `carta`: `ul.dcbw-carta` es la lista de
    // clásica), `.dcbw.dcbw-<id> {`. Sin ella la plantilla se pinta con los
    // neutros de `.dcbw` y parece sin terminar.
    assert.match(
      SKINS,
      new RegExp(`(^|\\n)(\\.dcbw)?\\.dcbw-${id}\\s*\\{`),
      `skins.css no tiene el bloque .dcbw-${id}`,
    );
  }
});

test("cada clave de copia que LEE el JSX de una plantilla está declarada en su manifiesto", () => {
  // Es la prueba de que el editor no miente: `copia(data, seccion, clave)`
  // devuelve el `porDefecto` del manifiesto, y si la clave no está
  // declarada devuelve "" — el botón sale vacío en público y el editor ni
  // siquiera ofrece el campo. Se leen las llamadas literales del código
  // fuente de cada t-<id>.tsx.
  const LLAMADA = /copia\(\s*data\s*,\s*"([a-z]+)"\s*,\s*"([a-zA-Z0-9.]+)"\s*\)/g;
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const fuente = readFileSync(path.join(CARPETA, `t-${id}.tsx`), "utf8");
    const m = BARBER_WEB_MANIFESTS[id];
    let leidas = 0;
    // Array.from y no `for…of` sobre el iterador: el tsconfig del repo no
    // fija `target` y TS exige downlevelIteration para iterar matchAll().
    for (const [, seccionId, clave] of Array.from(fuente.matchAll(LLAMADA))) {
      leidas++;
      const s = m.secciones.find((x) => x.id === seccionId);
      assert.ok(s, `t-${id}.tsx lee «${clave}» de la sección «${seccionId}», que su manifiesto no tiene`);
      assert.ok(
        s!.copia?.some((c) => c.clave === clave),
        `t-${id}.tsx lee «${clave}» pero el manifiesto de «${id}» no la declara en «${seccionId}»`,
      );
    }
    assert.ok(leidas > 0, `t-${id}.tsx no lee ninguna clave de copia con literal: ¿escribe sus textos a mano?`);
  }
});

test("cada manifiesto sugiere un acento del catálogo y sus claves de copia son «seccion.cosa»", () => {
  const acentos = new Set(BARBER_WEB_ACCENTS.map((a) => a.id));
  for (const id of BARBER_WEB_TEMPLATE_IDS) {
    const m = BARBER_WEB_MANIFESTS[id];
    assert.ok(acentos.has(m.acentoSugerido), `«${id}» sugiere el acento «${m.acentoSugerido}», que no existe`);
    for (const s of m.secciones) {
      for (const c of s.copia ?? []) {
        assert.match(c.clave, /^[a-z]+\.[a-zA-Z0-9]+$/, `«${id}»: la clave «${c.clave}» no es «seccion.cosa»`);
        assert.equal(
          c.clave.split(".")[0],
          s.id,
          `«${id}»: la clave «${c.clave}» está declarada en la sección «${s.id}», no en la suya`,
        );
        assert.ok(c.etiqueta.trim(), `«${id}»: la clave «${c.clave}» no tiene etiqueta para el editor`);
      }
    }
  }
});
