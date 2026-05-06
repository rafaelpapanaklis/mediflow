// Implants — tests del helper KPI agregado.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeImplantCountsFromRows } from "../specialty-kpis";
import type { ImplantPatientRow } from "../load-patients";

function row(overrides: Partial<ImplantPatientRow> = {}): ImplantPatientRow {
  return {
    implantId: "i1",
    patientId: "p1",
    patientName: "Test",
    doctorId: "d1",
    doctorName: "Dr Test",
    toothFdi: 16,
    brand: "STRAUMANN",
    brandCustomName: null,
    modelName: "BLT",
    status: "PLACED",
    placedAt: new Date("2026-01-01"),
    nextControlAt: null,
    nextControlMilestone: null,
    ...overrides,
  };
}

describe("computeImplantCountsFromRows", () => {
  it("activos excluye REMOVED y FAILED", () => {
    const rows = [
      row({ status: "PLACED" }),
      row({ status: "OSSEOINTEGRATING" }),
      row({ status: "FUNCTIONAL" }),
      row({ status: "REMOVED" }),
      row({ status: "FAILED" }),
    ];
    const k = computeImplantCountsFromRows(rows);
    assert.equal(k.activeImplants, 3);
  });

  it("inHealing solo cuenta OSSEOINTEGRATING", () => {
    const rows = [
      row({ status: "OSSEOINTEGRATING" }),
      row({ status: "OSSEOINTEGRATING" }),
      row({ status: "PLACED" }),
      row({ status: "LOADED_DEFINITIVE" }),
    ];
    const k = computeImplantCountsFromRows(rows);
    assert.equal(k.inHealing, 2);
  });

  it("inProsthetic cuenta UNCOVERED, LOADED_PROVISIONAL y LOADED_DEFINITIVE", () => {
    const rows = [
      row({ status: "UNCOVERED" }),
      row({ status: "LOADED_PROVISIONAL" }),
      row({ status: "LOADED_DEFINITIVE" }),
      row({ status: "FUNCTIONAL" }), // no incluido
      row({ status: "OSSEOINTEGRATING" }), // no
    ];
    const k = computeImplantCountsFromRows(rows);
    assert.equal(k.inProsthetic, 3);
  });
});
