import { test } from "node:test";
import assert from "node:assert/strict";
import { alergiasReales, esSinAlergia } from "../alergias-reales";

test("N/A, Ninguna, Niega y vacíos no son alergias", () => {
  assert.deepEqual(alergiasReales(["N/A", " Ninguna ", "niega", "", "  ", "Sin alergias", "No refiere"]), []);
});
test("las alergias reales se conservan", () => {
  assert.deepEqual(alergiasReales(["Penicilina", "N/A", "Látex "]), ["Penicilina", "Látex"]);
});
test("tolera null y valores raros", () => {
  assert.deepEqual(alergiasReales(null), []);
  assert.equal(esSinAlergia(undefined), true);
});
