// Tests de resolveTreatmentPlanAccess (arreglo de la revisión cruzada,
// REPORTE-ws1-t1.md — ws1-t4). Cubre el caso que fallaba hoy: recepción con
// solo billing.view (sin medicalRecord.view) perdía la ranura entera.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTreatmentPlanAccess } from "../_control-agenda-predicates";

describe("resolveTreatmentPlanAccess", () => {
  it("recepción (solo billing.view): antes fallaba entero, ahora pasa SIN abrir la hoja clínica", () => {
    const access = resolveTreatmentPlanAccess({ canClinical: false, canBilling: true });
    assert.equal(access.allowed, true);
    assert.equal(access.canOpenClinicalCard, false);
  });

  it("doctor (solo medicalRecord.view): pasa Y puede abrir la hoja clínica", () => {
    const access = resolveTreatmentPlanAccess({ canClinical: true, canBilling: false });
    assert.equal(access.allowed, true);
    assert.equal(access.canOpenClinicalCard, true);
  });

  it("con los dos permisos: pasa y abre la hoja clínica", () => {
    const access = resolveTreatmentPlanAccess({ canClinical: true, canBilling: true });
    assert.equal(access.allowed, true);
    assert.equal(access.canOpenClinicalCard, true);
  });

  it("sin ninguno de los dos: no pasa (nada que mostrar, ni siquiera cobranza)", () => {
    const access = resolveTreatmentPlanAccess({ canClinical: false, canBilling: false });
    assert.equal(access.allowed, false);
    assert.equal(access.canOpenClinicalCard, false);
  });
});

describe("resolveTreatmentPlanAccess — H67", () => {
  it("solo ver el expediente: entra, pero sin botón de hoja", () => {
    const access = resolveTreatmentPlanAccess({ canClinical: true, canBilling: false, canClinicalEdit: false });
    assert.equal(access.allowed, true);
    assert.equal(access.canOpenClinicalCard, false);
  });
  it("editar el expediente: con botón", () => {
    const access = resolveTreatmentPlanAccess({ canClinical: true, canBilling: false, canClinicalEdit: true });
    assert.equal(access.canOpenClinicalCard, true);
  });
});
