// H22 (QA ws1-t9): "Próximo control en N semanas" salía a la hora exacta del
// SERVIDOR (03:24) en vez de una hora de consulta, al abrir "Nuevo control"
// directo desde la ficha (no desde una cita). Ver next-card-visit-default.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { proximaFechaDeVisitaPorDefecto } from "../next-card-visit-default";

test("EL CASO QUE FALLABA HOY: hay una cita de control de HOY a las 10:00 — se usa esa hora, no la del reloj a las 03:24", () => {
  const ahora = new Date("2026-09-28T09:24:00.000Z"); // 03:24 hora del servidor (EDT)
  const citaHoy = new Date("2026-09-28T16:00:00.000Z"); // 10:00 CDMX
  const resultado = proximaFechaDeVisitaPorDefecto(citaHoy.toISOString(), ahora);
  assert.equal(resultado, citaHoy.toISOString());
});

test("cita de control es de OTRO día: no se usa, cae a la hora actual (comportamiento de siempre)", () => {
  const ahora = new Date("2026-09-28T09:24:00.000Z");
  const citaMañana = new Date("2026-09-29T16:00:00.000Z");
  const resultado = proximaFechaDeVisitaPorDefecto(citaMañana.toISOString(), ahora);
  assert.equal(resultado, ahora.toISOString());
});

test("sin próxima cita: cae a la hora actual", () => {
  const ahora = new Date("2026-09-28T09:24:00.000Z");
  assert.equal(proximaFechaDeVisitaPorDefecto(null, ahora), ahora.toISOString());
  assert.equal(proximaFechaDeVisitaPorDefecto(undefined, ahora), ahora.toISOString());
});

test("fecha de próxima cita inválida: no truena, cae a la hora actual", () => {
  const ahora = new Date("2026-09-28T09:24:00.000Z");
  assert.equal(proximaFechaDeVisitaPorDefecto("no-es-una-fecha", ahora), ahora.toISOString());
});
