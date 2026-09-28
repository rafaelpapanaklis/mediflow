import { test } from "node:test";
import assert from "node:assert/strict";
import { elegirSetParaFoto } from "../set-de-foto-por-visita";

const hoy = new Date(2026, 8, 28, 12, 0, 0);
const sets = [
  { setId: "t0", stage: "T0", date: new Date(2026, 0, 5).toISOString() },
  { setId: "c1", stage: "CONTROL", date: new Date(2026, 8, 1, 10).toISOString() },
];

test("T0 se reusa siempre", () => {
  assert.equal(elegirSetParaFoto(sets, "T0", hoy), "t0");
});
test("CONTROL de otro día no se reusa: se crea uno nuevo", () => {
  assert.equal(elegirSetParaFoto(sets, "CONTROL", hoy), null);
});
test("CONTROL de hoy se reusa para completar la visita", () => {
  const con = [...sets, { setId: "c2", stage: "CONTROL", date: new Date(2026, 8, 28, 9).toISOString() }];
  assert.equal(elegirSetParaFoto(con, "CONTROL", hoy), "c2");
});
test("sin sets de la etapa → null", () => {
  assert.equal(elegirSetParaFoto([], "T1", hoy), null);
});
