// Endodontics — tests del helper KPI agregado.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeEndoCountsFromRows } from "../specialty-kpis";
import type { EndoPatientRow } from "../load-patients";

function row(overrides: Partial<EndoPatientRow> = {}): EndoPatientRow {
  return {
    treatmentId: "t1",
    patientId: "p1",
    patientName: "Test",
    toothFdi: 11,
    treatmentType: "TC_PRIMARIO",
    doctorId: "d1",
    doctorName: "Dr Test",
    outcomeStatus: "EN_CURSO",
    currentStep: 1,
    sessionsCount: 1,
    startedAt: new Date("2026-01-01"),
    completedAt: null,
    needsRestoration: false,
    nextFollowUpAt: null,
    nextFollowUpMilestone: null,
    ...overrides,
  };
}

describe("computeEndoCountsFromRows", () => {
  it("cuenta tratamientos activos solo en EN_CURSO", () => {
    const rows = [
      row({ outcomeStatus: "EN_CURSO" }),
      row({ outcomeStatus: "EN_CURSO" }),
      row({ outcomeStatus: "COMPLETADO" }),
      row({ outcomeStatus: "FALLIDO" }),
    ];
    const k = computeEndoCountsFromRows(rows);
    assert.equal(k.activeTreatments, 2);
  });

  it("retratamientos solo cuenta los que están en curso y son RETRATAMIENTO", () => {
    const rows = [
      row({ treatmentType: "RETRATAMIENTO", outcomeStatus: "EN_CURSO" }),
      row({ treatmentType: "RETRATAMIENTO", outcomeStatus: "COMPLETADO" }), // no
      row({ treatmentType: "TC_PRIMARIO", outcomeStatus: "EN_CURSO" }), // no
    ];
    const k = computeEndoCountsFromRows(rows);
    assert.equal(k.retreatmentsActive, 1);
  });

  it("restauraciones pendientes = needsRestoration true", () => {
    const rows = [
      row({ needsRestoration: true }),
      row({ needsRestoration: true }),
      row({ needsRestoration: false }),
    ];
    const k = computeEndoCountsFromRows(rows);
    assert.equal(k.pendingRestorations, 2);
  });
});
