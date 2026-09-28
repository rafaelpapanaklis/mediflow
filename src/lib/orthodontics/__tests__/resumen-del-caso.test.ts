import { test } from "node:test";
import assert from "node:assert/strict";
import { bracketsDelCaso, cooperacionDelPaciente } from "../resumen-del-caso";

test("cuenta los brackets caídos de los controles firmados y los pendientes", () => {
  const r = bracketsDelCaso([
    { status: "SIGNED", brokenBrackets: [{ toothFdi: 13, reBondedDate: "2026-01-01" }, { toothFdi: 25, reBondedDate: null }] },
    { status: "DRAFT", brokenBrackets: [{ toothFdi: 11, reBondedDate: null }] },
    { status: "SIGNED", brokenBrackets: [] },
  ]);
  assert.deepEqual(r, { caidos: 2, pendientes: 1 });
});
test("cooperación: por el peor de los dos datos", () => {
  assert.equal(cooperacionDelPaciente(100, 90), "buena");
  assert.equal(cooperacionDelPaciente(100, 75), "regular");
  assert.equal(cooperacionDelPaciente(50, 95), "baja");
  assert.equal(cooperacionDelPaciente(90, null), "buena");
  assert.equal(cooperacionDelPaciente(null, null), null);
});
