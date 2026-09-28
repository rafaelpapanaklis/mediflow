import { test } from "node:test";
import assert from "node:assert/strict";
import { vencimientoDeCargoDeControl } from "../cobranza-controles-db";

// Un control firmado a las 18:30 del 28-sep en Ciudad de México ya es el 29 en UTC.
const firmado1830 = new Date("2026-09-29T00:30:00Z");

test("sin dueDate, vence el día de creación en la zona de la clínica (no en UTC)", () => {
  assert.equal(vencimientoDeCargoDeControl(null, firmado1830, "America/Mexico_City"), "2026-09-28");
});

test("sin zona usa la de México", () => {
  assert.equal(vencimientoDeCargoDeControl(null, firmado1830, null), "2026-09-28");
});

test("una zona inválida no rompe: cae a la de México", () => {
  assert.equal(vencimientoDeCargoDeControl(null, firmado1830, "Zona/Inventada"), "2026-09-28");
});

test("otra zona da su propio día", () => {
  assert.equal(vencimientoDeCargoDeControl(null, firmado1830, "Europe/Madrid"), "2026-09-29");
});

test("con dueDate manda la fecha de calendario guardada", () => {
  assert.equal(
    vencimientoDeCargoDeControl(new Date("2026-10-05T00:00:00Z"), firmado1830, "America/Mexico_City"),
    "2026-10-05",
  );
});
