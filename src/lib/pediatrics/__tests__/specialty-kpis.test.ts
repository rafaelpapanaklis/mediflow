// Pediatrics — tests del helper KPI agregado.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePediatricCountsFromRows } from "../specialty-kpis";
import type { PediatricPatientRow } from "../load-patients";

function row(overrides: Partial<PediatricPatientRow> = {}): PediatricPatientRow {
  return {
    patientId: "p1",
    patientName: "Test",
    ageDecimal: 5.4,
    ageLabel: "5 años 4 meses",
    cambra: "bajo",
    latestFranklValue: 3,
    nextAppointmentAt: null,
    nextAppointmentType: null,
    cariesRecallDue: false,
    ...overrides,
  };
}

describe("computePediatricCountsFromRows", () => {
  it("pacientes activos = total de filas", () => {
    const k = computePediatricCountsFromRows([row(), row(), row()]);
    assert.equal(k.activePatients, 3);
  });

  it("profilaxis pendientes cuenta solo cariesRecallDue=true", () => {
    const rows = [
      row({ cariesRecallDue: true }),
      row({ cariesRecallDue: true }),
      row({ cariesRecallDue: false }),
    ];
    const k = computePediatricCountsFromRows(rows);
    assert.equal(k.pendingProphylaxis, 2);
  });

  it("CAMBRA alto/extremo cuenta ambas categorías", () => {
    const rows = [
      row({ cambra: "alto" }),
      row({ cambra: "extremo" }),
      row({ cambra: "moderado" }),
      row({ cambra: "bajo" }),
      row({ cambra: null }),
    ];
    const k = computePediatricCountsFromRows(rows);
    assert.equal(k.highOrExtremeCambra, 2);
  });
});
