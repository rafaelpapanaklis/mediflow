// Periodontics — tests classifyCairo. SPEC §17.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyCairo } from "../cairo-classification";

describe("classifyCairo", () => {
  it("RT1: sin pérdida interproximal", () => {
    assert.equal(classifyCairo({ calInterproximalMm: 0, calVestibularMm: 3 }), "RT1");
  });

  it("RT2: pérdida interproximal ≤ vestibular", () => {
    assert.equal(classifyCairo({ calInterproximalMm: 2, calVestibularMm: 3 }), "RT2");
    assert.equal(classifyCairo({ calInterproximalMm: 2, calVestibularMm: 2 }), "RT2");
  });

  it("RT3: pérdida interproximal > vestibular", () => {
    assert.equal(classifyCairo({ calInterproximalMm: 4, calVestibularMm: 2 }), "RT3");
  });

  it("clampea valores negativos a 0 (sin pérdida)", () => {
    assert.equal(classifyCairo({ calInterproximalMm: -1, calVestibularMm: 2 }), "RT1");
  });
});
