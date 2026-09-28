// Ortodoncia — quién puede bajar el PDF de avance, que lleva fotos clínicas
// (ws1-t5, ronda 6 · X5 de la revisión de uso).

import { test } from "node:test";
import assert from "node:assert/strict";
import { puedeVerExpediente } from "../permiso-expediente";

test("dueño, administrador y doctor ven el expediente", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "DOCTOR"]) {
    assert.equal(puedeVerExpediente({ role, permissionsOverride: null }), true, role);
  }
});

test("recepción y solo lectura no lo ven", () => {
  for (const role of ["RECEPTIONIST", "READONLY"]) {
    assert.equal(puedeVerExpediente({ role, permissionsOverride: null }), false, role);
  }
});

test("un doctor al que la clínica le quitó el expediente no lo ve", () => {
  assert.equal(puedeVerExpediente({ role: "DOCTOR", permissionsOverride: ["billing.view"] }), false);
});

test("recepción a la que la clínica le dio el expediente sí lo ve", () => {
  assert.equal(puedeVerExpediente({ role: "RECEPTIONIST", permissionsOverride: ["medicalRecord.view"] }), true);
});

test("una lista de permisos vacía no quita nada: valen los del rol", () => {
  assert.equal(puedeVerExpediente({ role: "DOCTOR", permissionsOverride: [] }), true);
  assert.equal(puedeVerExpediente({ role: "RECEPTIONIST", permissionsOverride: [] }), false);
});

test("sin usuario, o con un rol que no existe, se niega", () => {
  assert.equal(puedeVerExpediente(null), false);
  assert.equal(puedeVerExpediente(undefined), false);
  assert.equal(puedeVerExpediente({ role: "INVENTADO", permissionsOverride: null }), false);
});
