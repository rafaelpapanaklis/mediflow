/**
 * ws1-t2 (ticket BEVADENT 3, 12h) — «Salud sin capturar».
 *
 * Run: npx tsx --test src/lib/patients/__tests__/salud-capturada.test.ts
 *
 * El verde «✓ Sin alergias registradas» solo dice la verdad con un cuestionario vigente. Antes la cabecera
 * lo pintaba con solo no tener alergias de riesgo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoSalud, puedePintarSinAlergias, saludPendiente } from "../salud-capturada";
import { textosSaludCapturada } from "../textos-salud-capturada";

test("sin cuestionario: salud sin capturar, pendiente y SIN el verde", () => {
  const e = estadoSalud("none");
  assert.equal(e, "sin_capturar");
  assert.equal(saludPendiente(e), true);
  assert.equal(puedePintarSinAlergias(e), false);
});

test("cuestionario vencido: pendiente y SIN el verde", () => {
  const e = estadoSalud("stale");
  assert.equal(e, "vencida");
  assert.equal(saludPendiente(e), true);
  assert.equal(puedePintarSinAlergias(e), false);
});

test("cuestionario vigente: el verde se pinta y no hay pendiente", () => {
  const e = estadoSalud("ok");
  assert.equal(e, "capturada");
  assert.equal(saludPendiente(e), false);
  assert.equal(puedePintarSinAlergias(e), true);
});

test("sin el dato (otra pantalla que no lo pasa) no se inventa nada: ni aviso ni cambio", () => {
  for (const v of [undefined, null]) {
    const e = estadoSalud(v);
    assert.equal(e, "desconocida");
    assert.equal(saludPendiente(e), false);
    assert.equal(puedePintarSinAlergias(e), true);
  }
});

test("textos en español e inglés, y el inglés no es el español", () => {
  const es = textosSaludCapturada("es");
  const en = textosSaludCapturada("en");
  assert.equal(es.sinCapturar, "Salud sin capturar");
  assert.equal(en.sinCapturar, "Health not recorded");
  for (const k of Object.keys(es) as (keyof typeof es)[]) {
    assert.ok(es[k].length > 0 && en[k].length > 0, `texto vacío: ${k}`);
    assert.notEqual(es[k], en[k], `sin traducir: ${k}`);
  }
  // Cualquier otro idioma cae en español, como el resto de los textos-*.ts.
  assert.equal(textosSaludCapturada("fr"), es);
});
