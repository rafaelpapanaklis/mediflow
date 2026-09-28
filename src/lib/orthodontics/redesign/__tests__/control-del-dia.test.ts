import { test } from "node:test";
import assert from "node:assert/strict";
import { tarjetaDeControlDeHoy } from "../control-del-dia";

const ZONA = "America/Mexico_City";
const hojaDeHoy = { id: "hoy", visitDate: new Date("2026-09-28T19:00:00Z") };

test("con el reloj de hoy encuentra la hoja de hoy", () => {
  assert.equal(tarjetaDeControlDeHoy([hojaDeHoy], ZONA, new Date("2026-09-28T22:00:00Z"))?.id, "hoy");
});
test("mirando el día de una cita de mañana, la hoja de hoy NO cuenta (se abre una nueva)", () => {
  const citaDeManana = new Date("2026-09-29T15:00:00Z");
  assert.equal(tarjetaDeControlDeHoy([hojaDeHoy], ZONA, citaDeManana), null);
});
test("si mañana ya tiene su hoja, esa es la que sale", () => {
  const deManana = { id: "manana", visitDate: new Date("2026-09-29T15:00:00Z") };
  assert.equal(tarjetaDeControlDeHoy([hojaDeHoy, deManana], ZONA, new Date("2026-09-29T15:00:00Z"))?.id, "manana");
});
