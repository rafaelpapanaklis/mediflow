// N-35 (segunda auditoría): el presupuesto público no decía el teléfono de la clínica. Con el código viejo la vista
// pública no traía `clinicPhone`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { toPublicView } from "../serialize";

test("la vista pública lleva el nombre y el teléfono de la clínica", () => {
  const v = toPublicView(
    { folio: "P-0013", title: "Plan", status: "ACCEPTED", items: [], subtotal: 2400, discountAmount: 0, total: 2400 },
    { clinicName: "Clínica de Prueba QA", clinicLogoUrl: null, clinicPhone: "55 0000 0000", patientFirstName: "Ana", signatureUrl: null, expired: false },
  );
  assert.equal(v.clinicName, "Clínica de Prueba QA");
  assert.equal(v.clinicPhone, "55 0000 0000");
});
