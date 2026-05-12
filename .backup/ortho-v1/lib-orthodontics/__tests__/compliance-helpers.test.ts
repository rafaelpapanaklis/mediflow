// Orthodontics — tests compliance-helpers. SPEC §13.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasDropRisk, summarizeCompliance } from "../compliance-helpers";

function ctrl(date: string, attendance: "ATTENDED" | "RESCHEDULED" | "NO_SHOW") {
  return {
    attendance,
    scheduledAt: new Date(date),
    performedAt: attendance === "ATTENDED" ? new Date(date) : null,
  };
}

describe("summarizeCompliance", () => {
  it("3/3 ATTENDED → ok", () => {
    const result = summarizeCompliance([
      ctrl("2026-03-15", "ATTENDED"),
      ctrl("2026-04-15", "ATTENDED"),
      ctrl("2026-05-15", "ATTENDED"),
    ]);
    assert.deepEqual(result, { level: "ok", attended: 3 });
  });

  it("2/3 con 1 RESCHEDULED → warning", () => {
    const result = summarizeCompliance([
      ctrl("2026-03-15", "ATTENDED"),
      ctrl("2026-04-15", "RESCHEDULED"),
      ctrl("2026-05-15", "ATTENDED"),
    ]);
    assert.equal(result.level, "warning");
    assert.equal(result.attended, 2);
  });

  it("2/3 con 1 NO_SHOW → warning + lastNoShow", () => {
    const result = summarizeCompliance([
      ctrl("2026-03-15", "ATTENDED"),
      ctrl("2026-04-15", "NO_SHOW"),
      ctrl("2026-05-15", "ATTENDED"),
    ]);
    assert.equal(result.level, "warning");
    assert.equal(result.attended, 2);
    if (result.level === "warning") {
      assert.ok(result.lastNoShow instanceof Date);
    }
  });

  it("1/3 ATTENDED → warning (downgrade visual a danger en card es UI)", () => {
    const result = summarizeCompliance([
      ctrl("2026-03-15", "NO_SHOW"),
      ctrl("2026-04-15", "RESCHEDULED"),
      ctrl("2026-05-15", "ATTENDED"),
    ]);
    assert.equal(result.level, "warning");
    assert.equal(result.attended, 1);
  });

  it("0/3 ATTENDED → danger + dropRisk", () => {
    const result = summarizeCompliance([
      ctrl("2026-03-15", "NO_SHOW"),
      ctrl("2026-04-15", "NO_SHOW"),
      ctrl("2026-05-15", "NO_SHOW"),
    ]);
    assert.equal(result.level, "danger");
    assert.equal(result.attended, 0);
    assert.ok(hasDropRisk(result));
  });

  it("<3 controles → insufficient (no penaliza)", () => {
    const result = summarizeCompliance([
      ctrl("2026-04-15", "ATTENDED"),
      ctrl("2026-05-15", "ATTENDED"),
    ]);
    assert.equal(result.level, "insufficient");
    assert.equal(result.attended, 2);
    assert.ok(!hasDropRisk(result));
  });

  it("toma últimos 3 cronológicos cuando hay más", () => {
    const result = summarizeCompliance([
      ctrl("2026-01-15", "NO_SHOW"),
      ctrl("2026-02-15", "NO_SHOW"),
      ctrl("2026-03-15", "ATTENDED"),
      ctrl("2026-04-15", "ATTENDED"),
      ctrl("2026-05-15", "ATTENDED"),
    ]);
    assert.deepEqual(result, { level: "ok", attended: 3 });
  });
});
