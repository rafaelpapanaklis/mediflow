// Orthodontics — tests del helper KPI agregado.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeOrthoKpis } from "../specialty-kpis";
import type { OrthoPatientRow } from "../load-patients";

function row(overrides: Partial<OrthoPatientRow> = {}): OrthoPatientRow {
  return {
    patientId: "p1",
    patientName: "Test Patient",
    doctorId: "d1",
    doctorName: "Dr Test",
    status: "IN_PROGRESS",
    treatmentPlanId: "tp1",
    diagnosisId: "dx1",
    currentPhase: "ALIGNMENT",
    monthInTreatment: 6,
    estimatedDurationMonths: 18,
    nextAppointmentAt: null,
    paymentStatus: "ON_TIME",
    amountOverdueMxn: 0,
    ...overrides,
  };
}

describe("computeOrthoKpis", () => {
  it("cuenta tratamientos activos solo cuando el plan existe y status es activo", () => {
    const rows = [
      row({ status: "IN_PROGRESS", treatmentPlanId: "tp1" }),
      row({ status: "PLANNED", treatmentPlanId: "tp2" }),
      row({ status: "RETENTION", treatmentPlanId: "tp3" }),
      row({ status: "ON_HOLD", treatmentPlanId: "tp4" }),
      row({ status: "COMPLETED", treatmentPlanId: "tp5" }), // no cuenta
      row({ status: "DIAGNOSIS_ONLY", treatmentPlanId: null }), // no cuenta
    ];
    const kpis = computeOrthoKpis(rows, 0);
    assert.equal(kpis.activeTreatments, 4);
  });

  it("agrega monto adeudado y cuenta filas con atraso", () => {
    const rows = [
      row({ paymentStatus: "ON_TIME", amountOverdueMxn: 0 }),
      row({ paymentStatus: "LIGHT_DELAY", amountOverdueMxn: 1500 }),
      row({ paymentStatus: "SEVERE_DELAY", amountOverdueMxn: 4500 }),
      row({ paymentStatus: "PAID_IN_FULL", amountOverdueMxn: 0 }),
    ];
    const kpis = computeOrthoKpis(rows, 0);
    assert.equal(kpis.overduePaymentsCount, 2);
    assert.equal(kpis.overduePaymentsAmountMxn, 6000);
  });

  it("finishingSoon detecta planes con <=1 mes restante en IN_PROGRESS", () => {
    const rows = [
      row({ status: "IN_PROGRESS", monthInTreatment: 17, estimatedDurationMonths: 18 }), // queda 1 → cuenta
      row({ status: "IN_PROGRESS", monthInTreatment: 18, estimatedDurationMonths: 18 }), // queda 0 → cuenta
      row({ status: "IN_PROGRESS", monthInTreatment: 16, estimatedDurationMonths: 18 }), // quedan 2 → no
      row({ status: "RETENTION", monthInTreatment: 18, estimatedDurationMonths: 18 }), // no IN_PROGRESS → no
      row({ status: "DIAGNOSIS_ONLY", monthInTreatment: null, estimatedDurationMonths: null }), // null → no
    ];
    const kpis = computeOrthoKpis(rows, 0);
    assert.equal(kpis.finishingSoon, 2);
  });

  it("propaga el conteo de citas hoy sin tocar las filas", () => {
    const kpis = computeOrthoKpis([], 7);
    assert.equal(kpis.todayAppointments, 7);
    assert.equal(kpis.activeTreatments, 0);
  });
});
