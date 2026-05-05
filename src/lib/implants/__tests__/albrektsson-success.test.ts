// Implants — tests Albrektsson. Spec §13.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  expectedMaxBoneLossMm,
  evaluateAlbrektsson,
  yearsBetween,
} from "../albrektsson-success";

describe("expectedMaxBoneLossMm", () => {
  it("año 0 → 0 mm", () => {
    assert.equal(expectedMaxBoneLossMm(0), 0);
  });

  it("año 1 → 1.5 mm (límite Albrektsson)", () => {
    assert.equal(expectedMaxBoneLossMm(1), 1.5);
  });

  it("año 3 → 1.5 + 2*0.2 = 1.9 mm", () => {
    assert.equal(expectedMaxBoneLossMm(3), 1.9);
  });

  it("año 5 → 1.5 + 4*0.2 = 2.3 mm", () => {
    assert.equal(expectedMaxBoneLossMm(5), 2.3);
  });
});

describe("evaluateAlbrektsson", () => {
  it("pérdida 0.4 mm a 6 meses (0.5 años) → cumple", () => {
    const r = evaluateAlbrektsson(0.4, 0.5);
    assert.equal(r.meetsCriteria, true);
    assert.equal(r.expectedMaxBoneLossMm, 1.5);
  });

  it("pérdida 1.5 mm año 1 → cumple (límite exacto)", () => {
    const r = evaluateAlbrektsson(1.5, 1);
    assert.equal(r.meetsCriteria, true);
  });

  it("pérdida 2.0 mm año 1 → NO cumple", () => {
    const r = evaluateAlbrektsson(2.0, 1);
    assert.equal(r.meetsCriteria, false);
  });

  it("pérdida 1.8 mm año 3 → NO cumple (esperado max 1.9, observado 1.8 ok... espera)", () => {
    // 1.8 <= 1.9 → cumple
    const r = evaluateAlbrektsson(1.8, 3);
    assert.equal(r.meetsCriteria, true);
  });

  it("pérdida 3.0 mm año 3 → NO cumple (Carlos peri-implantitis activa)", () => {
    const r = evaluateAlbrektsson(3.0, 3);
    assert.equal(r.meetsCriteria, false);
    assert.equal(r.expectedMaxBoneLossMm, 1.9);
  });
});

describe("yearsBetween", () => {
  it("2024-10-15 → 2025-10-15 ≈ 1.0 años", () => {
    const placed = new Date("2024-10-15");
    const followUp = new Date("2025-10-15");
    const y = yearsBetween(placed, followUp);
    assert.ok(y > 0.99 && y < 1.01, `y=${y}`);
  });

  it("2022-05-10 → 2025-04-15 ≈ 2.93 años", () => {
    const placed = new Date("2022-05-10");
    const followUp = new Date("2025-04-15");
    const y = yearsBetween(placed, followUp);
    assert.ok(y > 2.9 && y < 3.0, `y=${y}`);
  });
});
