// Endodontics — tests del comparativo radiográfico (PAI delta).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RADIOGRAPH_MILESTONES,
  RADIOGRAPH_MILESTONE_LABEL,
  availableMilestones,
  describePAI,
  describePaiDelta,
  effectivePaiScore,
  followUpMilestoneToRadiograph,
  paiDelta,
  type RadiographEntry,
} from "../milestones";

function entry(
  milestone: (typeof RADIOGRAPH_MILESTONES)[number],
  overrides: Partial<RadiographEntry> = {},
): RadiographEntry {
  return {
    id: milestone,
    fileUrl: `rx/${milestone}.jpg`,
    takenAt: "2026-05-05",
    milestone,
    ...overrides,
  };
}

describe("RADIOGRAPH_MILESTONES", () => {
  it("expone los 5 hitos en orden", () => {
    assert.deepEqual(
      [...RADIOGRAPH_MILESTONES],
      ["pre_tc", "post_tc_immediate", "control_6m", "control_12m", "control_24m"],
    );
  });
  it("cada hito tiene label en español", () => {
    for (const m of RADIOGRAPH_MILESTONES) {
      assert.ok(RADIOGRAPH_MILESTONE_LABEL[m]);
    }
  });
});

describe("followUpMilestoneToRadiograph", () => {
  it("CONTROL_6M/12M → control_6m/12m", () => {
    assert.equal(followUpMilestoneToRadiograph("CONTROL_6M"), "control_6m");
    assert.equal(followUpMilestoneToRadiograph("CONTROL_12M"), "control_12m");
  });
  it("CONTROL_24M y CONTROL_EXTRA caen a control_24m", () => {
    assert.equal(followUpMilestoneToRadiograph("CONTROL_24M"), "control_24m");
    assert.equal(followUpMilestoneToRadiograph("CONTROL_EXTRA"), "control_24m");
  });
  it("milestone desconocido → null", () => {
    assert.equal(followUpMilestoneToRadiograph("XX"), null);
  });
});

describe("effectivePaiScore", () => {
  it("manual gana sobre detectado", () => {
    const e = entry("pre_tc", { manualPaiScore: 4, detectedPaiScore: 2 });
    assert.equal(effectivePaiScore(e), 4);
  });
  it("usa detectado si no hay manual", () => {
    assert.equal(effectivePaiScore(entry("pre_tc", { detectedPaiScore: 3 })), 3);
  });
  it("regresa null si no hay ninguno", () => {
    assert.equal(effectivePaiScore(entry("pre_tc")), null);
  });
});

describe("paiDelta + describePaiDelta", () => {
  it("Mariana Torres retx 21: PAI 4 pre → PAI 2 control_12m → mejora 2", () => {
    const left = entry("pre_tc", { manualPaiScore: 4 });
    const right = entry("control_12m", { manualPaiScore: 2 });
    assert.equal(paiDelta(left, right), 2);
    assert.match(describePaiDelta(paiDelta(left, right)), /Mejora de 2 puntos/);
  });
  it("PAI estable cuando delta = 0 (Carlos Mendoza control 12m sin cambios)", () => {
    const left = entry("pre_tc", { manualPaiScore: 3 });
    const right = entry("control_6m", { manualPaiScore: 3 });
    assert.equal(paiDelta(left, right), 0);
    assert.equal(describePaiDelta(0), "PAI estable");
  });
  it("Empeoramiento cuando delta < 0", () => {
    const left = entry("pre_tc", { manualPaiScore: 2 });
    const right = entry("control_12m", { manualPaiScore: 4 });
    assert.equal(paiDelta(left, right), -2);
    assert.match(describePaiDelta(paiDelta(left, right)), /Empeoramiento de 2 puntos/);
  });
  it("regresa null si falta uno de los dos", () => {
    const left = entry("pre_tc");
    const right = entry("control_12m", { manualPaiScore: 2 });
    assert.equal(paiDelta(left, right), null);
  });
});

describe("availableMilestones", () => {
  it("regresa los milestones presentes en orden canónico", () => {
    const av = availableMilestones([entry("control_12m"), entry("pre_tc")]);
    assert.deepEqual(av, ["pre_tc", "control_12m"]);
  });
});

describe("describePAI", () => {
  it("describe los 5 niveles + fallback", () => {
    for (let i = 1; i <= 5; i++) assert.match(describePAI(i), new RegExp(`PAI ${i}`));
    assert.equal(describePAI(7), "PAI 7");
    assert.equal(describePAI(null), "—");
  });
});
