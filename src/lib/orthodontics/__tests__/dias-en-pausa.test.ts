import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiosDeEstadoDeBitacora, diasEnPausa } from "../dias-en-pausa";

const d = (s: string) => new Date(`${s}T12:00:00Z`);

test("suma una pausa que ya terminó", () => {
  const c = [
    { at: d("2026-03-01"), antes: "IN_PROGRESS", despues: "ON_HOLD" },
    { at: d("2026-03-31"), antes: "ON_HOLD", despues: "IN_PROGRESS" },
  ];
  assert.equal(diasEnPausa(c, "IN_PROGRESS", d("2026-09-01")), 30);
});
test("una pausa abierta cuenta hasta hoy", () => {
  const c = [{ at: d("2026-08-01"), antes: "IN_PROGRESS", despues: "ON_HOLD" }];
  assert.equal(diasEnPausa(c, "ON_HOLD", d("2026-09-01")), 31);
});
test("varias pausas se suman, sin importar el orden", () => {
  const c = [
    { at: d("2026-05-11"), antes: "ON_HOLD", despues: "IN_PROGRESS" },
    { at: d("2026-05-01"), antes: "IN_PROGRESS", despues: "ON_HOLD" },
    { at: d("2026-06-01"), antes: "IN_PROGRESS", despues: "ON_HOLD" },
    { at: d("2026-06-06"), antes: "ON_HOLD", despues: "IN_PROGRESS" },
  ];
  assert.equal(diasEnPausa(c, "IN_PROGRESS", d("2026-09-01")), 15);
});
test("sin historial: 0", () => {
  assert.equal(diasEnPausa([], "IN_PROGRESS", d("2026-09-01")), 0);
});
test("lee la bitácora ignorando filas sin cambio de estado", () => {
  const r = cambiosDeEstadoDeBitacora([
    { createdAt: d("2026-03-01"), changes: { status: { before: "IN_PROGRESS", after: "ON_HOLD" } } },
    { createdAt: d("2026-03-02"), changes: { totalCostMxn: { before: "1", after: "2" } } },
    { createdAt: d("2026-03-03"), changes: null },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].despues, "ON_HOLD");
});
