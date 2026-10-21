/**
 * ws1-t10 · P0 — las medidas de la hoja Carta y el reparto en hojas.
 *
 * Run: npm run test:hoja-carta
 *
 * Lo que fija:
 *  - Carta a 96 ppp: 816 × 1056, márgenes 72 / 86 / 72, membrete 96, pie 28 (la maqueta aprobada).
 *  - Las variables CSS y el `@page` del PDF salen de esos mismos números, nunca de una copia.
 *  - `paginar` corta entre bloques, respeta «Nueva página» y no abre una hoja vacía al final.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HOJA_CARTA, PPP, altoUtil, anchoUtil, paginaPdf, paginar, pxAPulgadas, variablesCssHoja,
} from "../hoja-carta";

test("la hoja es Carta a 96 ppp con las medidas de la maqueta", () => {
  assert.equal(PPP, 96);
  assert.equal(HOJA_CARTA.ancho, 8.5 * PPP);
  assert.equal(HOJA_CARTA.alto, 11 * PPP);
  assert.deepEqual(
    { ...HOJA_CARTA },
    { ancho: 816, alto: 1056, margenSuperior: 72, margenLateral: 86, margenInferior: 72, membreteAlto: 96, pieAlto: 28, mesaEntre: 28 },
  );
  assert.ok(Object.isFrozen(HOJA_CARTA), "nadie cambia las medidas en caliente");
  assert.equal(altoUtil(), 1056 - 72 - 96 - 72);
  assert.equal(anchoUtil(), 816 - 2 * 86);
});

test("las variables CSS y el @page del PDF salen de las mismas medidas", () => {
  const v = variablesCssHoja();
  assert.equal(v["--hoja-ancho"], "816px");
  assert.equal(v["--hoja-alto"], "1056px");
  assert.equal(v["--hoja-m-sup"], "72px");
  assert.equal(v["--hoja-m-lat"], "86px");
  assert.equal(v["--hoja-m-inf"], "72px");
  assert.equal(v["--hoja-cab-alto"], "96px");
  assert.equal(v["--hoja-pie-alto"], "28px");
  assert.equal(v["--hoja-mesa-entre"], "28px");
  assert.ok(Object.keys(v).every((k) => k.startsWith("--hoja-")));

  assert.equal(pxAPulgadas(96), "1in");
  assert.equal(pxAPulgadas(72), ".75in");
  assert.equal(pxAPulgadas(86), ".896in");
  assert.deepEqual(paginaPdf(), { tamano: "letter", margen: ".75in .896in .75in .896in" });
});

test("paginar: sin bloques hay una hoja entera de relleno", () => {
  assert.deepEqual(paginar([]), { saltosAntesDe: [], paginas: 1, relleno: altoUtil() });
});

test("paginar: corta ENTRE bloques cuando la hoja se llena", () => {
  const r = paginar([{ alto: 300 }, { alto: 300 }, { alto: 300 }, { alto: 100 }], { altoUtil: 816 });
  // 300 + 300 = 600 cabe; el tercero (900) no → hoja 2 empieza en el índice 2.
  assert.deepEqual(r.saltosAntesDe, [2]);
  assert.equal(r.paginas, 2);
  assert.equal(r.relleno, 816 - 400);
});

test("paginar: lo que ocupa la cabecera de la primera hoja cuenta solo en la primera", () => {
  const r = paginar([{ alto: 500 }, { alto: 500 }, { alto: 500 }], { altoUtil: 816, extraPrimera: 400 });
  // 400 + 500 = 900 > 816 → el primer bloque ya se va a la hoja 2 (la cabecera queda sola arriba).
  assert.deepEqual(r.saltosAntesDe, [0, 1, 2]);
  assert.equal(r.paginas, 4);
});

test("paginar: un bloque más alto que la hoja se queda solo en la suya y nunca se parte", () => {
  const r = paginar([{ alto: 100 }, { alto: 2000 }, { alto: 100 }], { altoUtil: 816 });
  assert.deepEqual(r.saltosAntesDe, [1, 2]);
  assert.equal(r.paginas, 3);
  assert.equal(r.relleno, 716);
});

test("paginar: «Nueva página» cierra la hoja aunque sobre sitio", () => {
  const r = paginar([{ alto: 100 }, { alto: 26, saltoManual: true }, { alto: 100 }], { altoUtil: 816 });
  assert.deepEqual(r.saltosAntesDe, [2]);
  assert.equal(r.paginas, 2);
  assert.equal(r.relleno, 716);
});

test("paginar: un «Nueva página» al final del documento no abre una hoja vacía", () => {
  const r = paginar([{ alto: 100 }, { alto: 26, saltoManual: true }], { altoUtil: 816 });
  assert.deepEqual(r.saltosAntesDe, []);
  assert.equal(r.paginas, 1);
});

test("paginar: dos «Nueva página» seguidos dejan una hoja en blanco a propósito", () => {
  const r = paginar(
    [{ alto: 100 }, { alto: 26, saltoManual: true }, { alto: 26, saltoManual: true }, { alto: 100 }],
    { altoUtil: 816 },
  );
  assert.deepEqual(r.saltosAntesDe, [2, 3]);
  assert.equal(r.paginas, 3);
});

test("paginar: alturas raras (negativas, NaN) no rompen el reparto", () => {
  const r = paginar([{ alto: -5 }, { alto: Number.NaN }, { alto: 10 }], { altoUtil: 100 });
  assert.deepEqual(r.saltosAntesDe, []);
  assert.equal(r.relleno, 90);
});
