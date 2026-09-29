import { test } from "node:test";
import assert from "node:assert/strict";
import { errorDeFechaDePromesa } from "../cobro/fecha-de-promesa";

test("hoy y días futuros valen", () => {
  assert.equal(errorDeFechaDePromesa("2026-09-28", "2026-09-28"), null);
  assert.equal(errorDeFechaDePromesa("2026-10-15", "2026-09-28"), null);
});
test("una fecha pasada se rechaza", () => {
  assert.match(errorDeFechaDePromesa("2026-09-20", "2026-09-28") ?? "", /anterior a hoy/);
});
test("formato o día imposible se rechazan", () => {
  assert.match(errorDeFechaDePromesa("20-09-2026", "2026-09-28") ?? "", /inválida/);
  assert.match(errorDeFechaDePromesa("2026-02-31", "2026-09-28") ?? "", /inválida/);
});
