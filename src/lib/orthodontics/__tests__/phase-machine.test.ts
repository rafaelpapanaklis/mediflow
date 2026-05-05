// Orthodontics — tests phase-machine. SPEC §13.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHASE_ORDER,
  canAdvance,
  canForceTransition,
  classifyTransition,
  nextPhase,
  previousPhase,
} from "../phase-machine";

describe("phase-machine", () => {
  it("PHASE_ORDER tiene 6 fases en orden canónico", () => {
    assert.deepEqual(PHASE_ORDER, [
      "ALIGNMENT",
      "LEVELING",
      "SPACE_CLOSURE",
      "DETAILS",
      "FINISHING",
      "RETENTION",
    ]);
  });

  it("nextPhase devuelve siguiente lineal", () => {
    assert.equal(nextPhase("ALIGNMENT"), "LEVELING");
    assert.equal(nextPhase("LEVELING"), "SPACE_CLOSURE");
    assert.equal(nextPhase("FINISHING"), "RETENTION");
  });

  it("nextPhase de RETENTION devuelve null", () => {
    assert.equal(nextPhase("RETENTION"), null);
  });

  it("previousPhase de ALIGNMENT devuelve null", () => {
    assert.equal(previousPhase("ALIGNMENT"), null);
  });

  it("canAdvance acepta solo transición lineal +1", () => {
    assert.ok(canAdvance("ALIGNMENT", "LEVELING"));
    assert.ok(!canAdvance("ALIGNMENT", "DETAILS"));
    assert.ok(!canAdvance("ALIGNMENT", "ALIGNMENT"));
    assert.ok(!canAdvance("LEVELING", "ALIGNMENT"));
  });

  it("canForceTransition acepta cualquier salto entre fases conocidas", () => {
    assert.ok(canForceTransition("ALIGNMENT", "RETENTION"));
    assert.ok(canForceTransition("RETENTION", "DETAILS"));
    assert.ok(!canForceTransition("ALIGNMENT", "ALIGNMENT"));
  });

  it("classifyTransition diferencia advance/skip/rollback/invalid", () => {
    assert.equal(classifyTransition("ALIGNMENT", "LEVELING"), "advance");
    assert.equal(classifyTransition("ALIGNMENT", "FINISHING"), "skip");
    assert.equal(classifyTransition("DETAILS", "ALIGNMENT"), "rollback");
    assert.equal(classifyTransition("ALIGNMENT", "ALIGNMENT"), "invalid");
  });
});
