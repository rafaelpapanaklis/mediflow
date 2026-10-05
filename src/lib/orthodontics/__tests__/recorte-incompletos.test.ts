/**
 * Tablero de Ortodoncia: «Casos con diagnóstico o plan incompleto», contador = lista (ws1-t9, #8).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/recorte-incompletos.test.ts
 *
 * Con el código viejo la lista hacía `slice(0, 5)` sin decirlo: contador 6, lista 5.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIMITE_LISTA_INCOMPLETOS, recorteDeIncompletos } from "../recorte-incompletos";

const casos = (n: number) => Array.from({ length: n }, (_, i) => ({ planId: `p${i}` }));

test("con 6 casos (el de la revisión) la lista trae los 6 y no hay leyenda", () => {
  const r = recorteDeIncompletos(casos(6));
  assert.equal(r.visibles.length, 6);
  assert.equal(r.ocultos, 0);
  assert.equal(r.leyenda, null);
});

test("si hay más que el límite, la lista lo dice con números y el resto se cuenta", () => {
  const r = recorteDeIncompletos(casos(14));
  assert.equal(r.visibles.length, LIMITE_LISTA_INCOMPLETOS);
  assert.equal(r.ocultos, 14 - LIMITE_LISTA_INCOMPLETOS);
  assert.equal(r.leyenda, `Mostrando ${LIMITE_LISTA_INCOMPLETOS} de 14`);
});

test("sin casos no hay nada que recortar", () => {
  const r = recorteDeIncompletos([]);
  assert.deepEqual([r.visibles.length, r.ocultos, r.leyenda], [0, 0, null]);
});

test("el Tablero usa el recorte (no un slice mudo) y el contador sale del mismo arreglo", () => {
  const src = readFileSync(join(process.cwd(), "src/components/specialties/orthodontics/modulo/vista-tablero.tsx"), "utf8");
  assert.doesNotMatch(src, /incompletos\.slice\(0, 5\)/);
  assert.match(src, /recorteDeIncompletos\(data\.incompletos\)\.visibles/);
  assert.match(src, /value=\{String\(data\.incompletos\.length\)\}/);
});
