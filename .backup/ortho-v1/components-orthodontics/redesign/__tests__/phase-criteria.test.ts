// Tests del checklist clínico del ModalAdvancePhase.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PHASE_CRITERIA } from "../drawers/ModalAdvancePhase";
import { PHASE_ORDER } from "../types";

describe("PHASE_CRITERIA", () => {
  it("define checklist para las 6 fases canónicas", () => {
    for (const phase of PHASE_ORDER) {
      assert.ok(phase in PHASE_CRITERIA, `Falta checklist para ${phase}`);
    }
  });

  it("ALIGNMENT exige bonding completo + foto T0", () => {
    const keys = PHASE_CRITERIA.ALIGNMENT.map((c) => c.key);
    assert.ok(keys.includes("all-bonded"));
    assert.ok(keys.includes("photos-t0"));
  });

  it("LEVELING exige higiene <30% placa", () => {
    const labels = PHASE_CRITERIA.LEVELING.map((c) => c.label).join(" ");
    assert.match(labels, /higiene/i);
  });

  it("FINISHING exige LabOrder de retenedores enviada", () => {
    const labels = PHASE_CRITERIA.FINISHING.map((c) => c.label).join(" ");
    assert.match(labels, /retenedor/i);
  });

  it("cada criterio tiene key única dentro de su fase", () => {
    for (const phase of PHASE_ORDER) {
      const criteria = PHASE_CRITERIA[phase];
      const keys = criteria.map((c) => c.key);
      const unique = new Set(keys);
      assert.equal(keys.length, unique.size, `Keys duplicadas en ${phase}`);
    }
  });

  it("cada criterio tiene label no vacío", () => {
    for (const phase of PHASE_ORDER) {
      for (const c of PHASE_CRITERIA[phase]) {
        assert.ok(c.label.length > 0, `Label vacío en ${phase}/${c.key}`);
      }
    }
  });
});
