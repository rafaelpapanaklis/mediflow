import { test } from "node:test";
import assert from "node:assert/strict";
import { gastoDe, margenDe } from "../margen";
import { sumarCostoDeReceta } from "../../../../lib/inventory/costo-receta.server";

test("sin gasto manual, manda el costo de la receta", () => {
  assert.deepEqual(gastoDe(null, 11), { monto: 11, origen: "receta" });
  assert.deepEqual(gastoDe(undefined, 11), { monto: 11, origen: "receta" });
});

test("el gasto manual manda si existe, aunque sea 0", () => {
  assert.deepEqual(gastoDe(40, 11), { monto: 40, origen: "manual" });
  assert.deepEqual(gastoDe(0, 11), { monto: 0, origen: "manual" });
});

test("sin manual y sin receta útil no hay gasto ni margen", () => {
  assert.equal(gastoDe(null, undefined), null);
  assert.equal(gastoDe(null, 0), null);
  assert.equal(gastoDe(null, NaN), null);
  assert.equal(margenDe(500, gastoDe(null, 0)?.monto ?? null), null);
});

test("margen con gasto de receta: Profilaxis $500, guantes ×2 a $5.50", () => {
  const g = gastoDe(null, 2 * 5.5);
  assert.equal(margenDe(500, g ? g.monto : null), 489);
});

test("suma de receta por procedimiento", () => {
  const r = sumarCostoDeReceta([
    { procedureId: "a", quantity: 2, unitCost: 5.5 },
    { procedureId: "a", quantity: 1, unitCost: 10 },
    { procedureId: "b", quantity: 3, unitCost: 0 },
  ]);
  assert.deepEqual(r, { a: 21, b: 0 });
});
