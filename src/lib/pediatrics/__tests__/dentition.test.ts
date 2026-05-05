// Pediatrics — tests para clasificador de dentición. Spec: §4.A.1, §6.1 casos del brief.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDentition,
  isTemporalFdi,
  isPermanentFdi,
  TEMPORAL_FDI,
  PERMANENT_FDI,
} from "../dentition";

describe("classifyDentition", () => {
  it("Mateo (4.58a, 0 permanentes) -> temporal", () => {
    assert.equal(classifyDentition({ ageDecimal: 4.58, eruptedPermanent: 0 }), "temporal");
  });

  it("Sofía (8.17a, 8 permanentes) -> mixta", () => {
    assert.equal(classifyDentition({ ageDecimal: 8.17, eruptedPermanent: 8 }), "mixta");
  });

  it("Diego (12.92a, 28 permanentes) -> permanente", () => {
    assert.equal(classifyDentition({ ageDecimal: 12.92, eruptedPermanent: 28 }), "permanente");
  });

  it("niño 6.5a sin permanentes registrados -> mixta (heurística)", () => {
    assert.equal(classifyDentition({ ageDecimal: 6.5, eruptedPermanent: 0 }), "mixta");
  });

  it("niño 13a con 26 permanentes -> permanente", () => {
    assert.equal(classifyDentition({ ageDecimal: 13.0, eruptedPermanent: 26 }), "permanente");
  });
});

describe("isTemporalFdi / isPermanentFdi", () => {
  it("clasifica correctamente cada FDI temporal", () => {
    for (const fdi of TEMPORAL_FDI) {
      assert.equal(isTemporalFdi(fdi), true, `FDI ${fdi} debería ser temporal`);
      assert.equal(isPermanentFdi(fdi), false);
    }
  });

  it("clasifica correctamente cada FDI permanente", () => {
    for (const fdi of PERMANENT_FDI) {
      assert.equal(isPermanentFdi(fdi), true, `FDI ${fdi} debería ser permanente`);
      assert.equal(isTemporalFdi(fdi), false);
    }
  });

  it("hay 20 dientes temporales y 32 permanentes", () => {
    assert.equal(TEMPORAL_FDI.length, 20);
    assert.equal(PERMANENT_FDI.length, 32);
  });
});
