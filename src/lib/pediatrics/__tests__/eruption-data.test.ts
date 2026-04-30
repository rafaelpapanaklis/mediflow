// Pediatrics — tests para tabla OMS de erupción. Spec: §4.A.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ERUPTION_TABLE,
  evaluateDeviation,
  getRangeForFdi,
} from "../eruption-data";

describe("ERUPTION_TABLE", () => {
  it("contiene 52 dientes (20 temporales + 32 permanentes)", () => {
    assert.equal(ERUPTION_TABLE.length, 52);
    const temp = ERUPTION_TABLE.filter((r) => r.type === "temporal");
    const perm = ERUPTION_TABLE.filter((r) => r.type === "permanent");
    assert.equal(temp.length, 20);
    assert.equal(perm.length, 32);
  });

  it("todos los rangos cumplen min <= mean <= max", () => {
    for (const r of ERUPTION_TABLE) {
      assert.ok(r.minMonths <= r.meanMonths, `FDI ${r.fdi}: min ${r.minMonths} > mean ${r.meanMonths}`);
      assert.ok(r.meanMonths <= r.maxMonths, `FDI ${r.fdi}: mean ${r.meanMonths} > max ${r.maxMonths}`);
    }
  });

  it("incisivos centrales superiores temporales (51, 61) erupcionan 8-12m", () => {
    const r51 = getRangeForFdi(51)!;
    assert.equal(r51.minMonths, 8);
    assert.equal(r51.maxMonths, 12);
    assert.equal(r51.type, "temporal");
  });

  it("primer molar permanente inferior (36, 46) ~6-7 años", () => {
    const r36 = getRangeForFdi(36)!;
    assert.equal(r36.type, "permanent");
    assert.equal(r36.minMonths, 6 * 12);
    assert.equal(r36.maxMonths, 7 * 12);
  });

  it("getRangeForFdi devuelve null para FDI inválido", () => {
    assert.equal(getRangeForFdi(99), null);
  });
});

describe("evaluateDeviation", () => {
  const range = { fdi: 51, type: "temporal" as const, minMonths: 8, maxMonths: 12, meanMonths: 10, arch: "upper" as const, position: "central" as const };

  it("dentro del rango -> within", () => {
    assert.equal(evaluateDeviation(10, range), "within");
    assert.equal(evaluateDeviation(8, range), "within");
    assert.equal(evaluateDeviation(12, range), "within");
  });

  it("Mateo: incisivo erupcionó a los 7 meses -> early (mild si delta<=12)", () => {
    assert.equal(evaluateDeviation(7, range), "early");
  });

  it("delta de 5 meses por encima -> mild", () => {
    assert.equal(evaluateDeviation(17, range), "mild");
  });

  it("delta >12 meses -> pathological en cualquier dirección", () => {
    assert.equal(evaluateDeviation(25, range), "pathological");
    assert.equal(evaluateDeviation(-5, range), "pathological");
  });
});
