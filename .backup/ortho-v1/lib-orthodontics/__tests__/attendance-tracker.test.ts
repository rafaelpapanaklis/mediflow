// Orthodontics — tests de las métricas que alimentan OrthoAttendanceTracker.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeCompliance, hasDropRisk } from "../compliance-helpers";
import type { ControlAttendance } from "@prisma/client";

function ctrl(daysAgo: number, attendance: ControlAttendance) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return {
    attendance,
    scheduledAt: d,
    performedAt: attendance === "ATTENDED" ? d : null,
  };
}

describe("AttendanceTracker computations", () => {
  it("0/3 ATTENDED dispara drop risk", () => {
    const summary = summarizeCompliance([
      ctrl(30, "NO_SHOW"),
      ctrl(60, "NO_SHOW"),
      ctrl(90, "NO_SHOW"),
    ]);
    assert.equal(summary.level, "danger");
    assert.equal(hasDropRisk(summary), true);
  });

  it("3/3 ATTENDED reporta ok", () => {
    const summary = summarizeCompliance([
      ctrl(30, "ATTENDED"),
      ctrl(60, "ATTENDED"),
      ctrl(90, "ATTENDED"),
    ]);
    assert.equal(summary.level, "ok");
    assert.equal(hasDropRisk(summary), false);
  });

  it("2/3 ATTENDED reporta warning", () => {
    const summary = summarizeCompliance([
      ctrl(30, "ATTENDED"),
      ctrl(60, "NO_SHOW"),
      ctrl(90, "ATTENDED"),
    ]);
    assert.equal(summary.level, "warning");
  });

  it("menos de 3 controles reporta insufficient", () => {
    const summary = summarizeCompliance([ctrl(30, "ATTENDED")]);
    assert.equal(summary.level, "insufficient");
  });

  it("orden por scheduledAt desc se respeta", () => {
    const summary = summarizeCompliance([
      ctrl(90, "ATTENDED"),
      ctrl(30, "NO_SHOW"),
      ctrl(60, "NO_SHOW"),
    ]);
    // Tres últimos: -30 NO_SHOW, -60 NO_SHOW, -90 ATTENDED → 1/3
    assert.equal(summary.level, "warning");
    assert.equal(summary.attended, 1);
  });
});
