/**
 * `findingRegions` decide qué hallazgos de IA se dibujan sobre la
 * radiografía. Antes de esta prueba, un finding SIN coordenadas reales
 * recibía una posición de una grilla 4x2 fija y se dibujaba como si la IA
 * hubiera señalado ese punto — el recuadro podía caer sobre un diente sano.
 * El modelo hoy nunca manda `region`, así que ese engaño ocurría siempre.
 *
 * Run: npm run test:xrays-finding-regions
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findingRegions, type AiFinding } from "../finding-regions";

function finding(over: Partial<AiFinding> = {}): AiFinding {
  return {
    id: "1",
    title: "Caries",
    severity: "media",
    ...over,
  };
}

test("un finding con region real: pasa, con su region intacta", () => {
  const region = { x: 10, y: 20, w: 15, h: 15 };
  const out = findingRegions([finding({ region })]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].region, region);
});

test("un finding SIN region: no se inventa ninguna, y no sale en el resultado", () => {
  const out = findingRegions([finding({ region: undefined })]);
  assert.equal(out.length, 0, "sin coordenadas reales, no hay nada que dibujar sobre la imagen");
});

test("varios findings sin region: ninguno cae en la vieja grilla 4x2 — todos fuera", () => {
  const out = findingRegions([finding({ id: "1" }), finding({ id: "2" }), finding({ id: "3" })]);
  assert.deepEqual(out, []);
});

test("mezcla: solo pasan los que sí traen region, en el mismo orden", () => {
  const conRegion = { x: 30, y: 40, w: 10, h: 10 };
  const out = findingRegions([
    finding({ id: "1" }),
    finding({ id: "2", region: conRegion }),
    finding({ id: "3" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "2");
  assert.deepEqual(out[0].region, conRegion);
});

test("no muta el array de entrada", () => {
  const findings = [finding({ id: "1" }), finding({ id: "2", region: { x: 1, y: 1, w: 1, h: 1 } })];
  const copia = findings.map((f) => ({ ...f }));
  findingRegions(findings);
  assert.deepEqual(findings, copia);
});
