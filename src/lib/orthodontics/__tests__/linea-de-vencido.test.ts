import { test } from "node:test";
import assert from "node:assert/strict";
import { resumenDeVencidas, tituloDeVencido } from "../cobro/linea-de-vencido";

const fmt = (n: number) => `$${n}`;

test("una vencida: el mismo número que el botón", () => {
  const r = resumenDeVencidas([{ falta: 1000, vencimiento: "2026-08-15T12:00:00Z" }]);
  assert.equal(tituloDeVencido(r, fmt), "Mensualidad vencida: $1000");
});
test("varias vencidas: suma y cuántas, con la fecha de la más antigua", () => {
  const r = resumenDeVencidas([
    { falta: 3400, vencimiento: "2026-08-15T12:00:00Z" },
    { falta: 1000, vencimiento: "2026-09-15T12:00:00Z" },
  ]);
  assert.equal(r.total, 4400);
  assert.equal(r.cuantas, 2);
  assert.equal(r.masAntigua?.slice(0, 10), "2026-08-15");
  assert.equal(tituloDeVencido(r, fmt), "2 mensualidades vencidas: $4400");
});
