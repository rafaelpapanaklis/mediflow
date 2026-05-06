// Periodontics — tests del helper KPI agregado.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPerioPlans } from "../specialty-kpis";

const NOW = new Date("2026-05-06T12:00:00Z");
const past = new Date("2026-04-01T00:00:00Z");
const future = new Date("2026-08-01T00:00:00Z");

describe("classifyPerioPlans", () => {
  it("PHASE_4 con nextEvaluationAt vencido → mantenimiento vencido", () => {
    const k = classifyPerioPlans(
      [{ currentPhase: "PHASE_4", nextEvaluationAt: past }],
      NOW,
    );
    assert.equal(k.overdueMaintenance, 1);
    assert.equal(k.pendingReevaluations, 0);
  });

  it("Otra fase con nextEvaluationAt vencido → reevaluación pendiente", () => {
    const k = classifyPerioPlans(
      [
        { currentPhase: "PHASE_1", nextEvaluationAt: past },
        { currentPhase: "PHASE_2", nextEvaluationAt: past },
        { currentPhase: "PHASE_3", nextEvaluationAt: past },
      ],
      NOW,
    );
    assert.equal(k.overdueMaintenance, 0);
    assert.equal(k.pendingReevaluations, 3);
  });

  it("ignora planes con nextEvaluationAt en el futuro o null", () => {
    const k = classifyPerioPlans(
      [
        { currentPhase: "PHASE_4", nextEvaluationAt: future },
        { currentPhase: "PHASE_4", nextEvaluationAt: null },
        { currentPhase: "PHASE_2", nextEvaluationAt: future },
      ],
      NOW,
    );
    assert.equal(k.overdueMaintenance, 0);
    assert.equal(k.pendingReevaluations, 0);
  });
});
