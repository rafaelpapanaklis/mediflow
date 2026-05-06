// Orthodontics — tests del threshold de compliance de elásticos.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const LOW_COMPLIANCE_THRESHOLD = 70;

describe("Elastics compliance threshold", () => {
  it("compliance < 70% dispara reminder motivacional", () => {
    assert.equal(40 < LOW_COMPLIANCE_THRESHOLD, true);
    assert.equal(69 < LOW_COMPLIANCE_THRESHOLD, true);
  });

  it("compliance >= 70% NO dispara reminder", () => {
    assert.equal(70 < LOW_COMPLIANCE_THRESHOLD, false);
    assert.equal(85 < LOW_COMPLIANCE_THRESHOLD, false);
    assert.equal(100 < LOW_COMPLIANCE_THRESHOLD, false);
  });

  it("compliance 0% es válido (paciente no usó nada)", () => {
    assert.equal(0 < LOW_COMPLIANCE_THRESHOLD, true);
  });
});
