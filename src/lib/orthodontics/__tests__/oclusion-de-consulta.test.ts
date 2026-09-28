import { test } from "node:test";
import assert from "node:assert/strict";
import { oclusionDeLaConsulta } from "../oclusion-de-consulta";

test("lee clase, sobremordida, overjet y mordida de la consulta", () => {
  const r = oclusionDeLaConsulta({
    occlusal: { molarClass: "Clase II div 1", bite: ["Cruzada posterior", "Abierta anterior"], overbite: "3.5", overjet: "6" },
  });
  assert.deepEqual(r, { angleClass: "CLASS_II_DIV_1", overbiteMm: 3.5, overjetMm: 6, crossbite: true, openBite: true });
});
test("sin datos de oclusión devuelve null", () => {
  assert.equal(oclusionDeLaConsulta({ occlusal: { molarClass: "", bite: [], overbite: "", overjet: "" } }), null);
  assert.equal(oclusionDeLaConsulta(null), null);
  assert.equal(oclusionDeLaConsulta({}), null);
});
test("valores absurdos se ignoran", () => {
  assert.equal(oclusionDeLaConsulta({ occlusal: { overjet: "500" } }), null);
});
