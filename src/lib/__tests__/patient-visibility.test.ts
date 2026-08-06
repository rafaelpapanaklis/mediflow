/**
 * Visibilidad por paciente — la regla que la Ola 3 aplica a las ESCRITURAS.
 *
 * Run: npm run test:patient-visibility
 *
 * Cubre el núcleo PURO del helper (canSeePatient / patientVisibilityFilter y
 * derivados): assertPatientVisible y canViewPatient son una findFirst delgada
 * sobre patientVisibilityFilter, así que fijar aquí la forma del filtro fija
 * el enforcement de TODAS las rutas que lo usan (lecturas y, desde esta ola,
 * también las escrituras: odontograma, records, notas, anotaciones, CBCT,
 * modelos 3D, cancelar/check-in de cita, factura desde cita y paquetes).
 *
 * Casos exigidos por el encargo: permitido / denegado / admin siempre pasa /
 * lista vacía = todos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSeePatient,
  patientVisibilityFilter,
  patientVisibilityAnd,
  relatedPatientVisibilityAnd,
  isVisibilityAdmin,
  type VisibilityViewer,
} from "../patient-visibility";

const CLINIC = "clinic_1";
const doctorA: VisibilityViewer = { userId: "doc_A", role: "DOCTOR", clinicId: CLINIC };
const doctorB: VisibilityViewer = { userId: "doc_B", role: "DOCTOR", clinicId: CLINIC };
const recep: VisibilityViewer = { userId: "rec_1", role: "RECEPTIONIST", clinicId: CLINIC };
const admin: VisibilityViewer = { userId: "adm_1", role: "ADMIN", clinicId: CLINIC };
const superAdmin: VisibilityViewer = { userId: "sa_1", role: "SUPER_ADMIN", clinicId: CLINIC };

test("lista vacía = TODOS lo ven (el default histórico, cero cambios)", () => {
  for (const v of [doctorA, doctorB, recep, admin, superAdmin]) {
    assert.equal(canSeePatient(v, []), true, `${v.role} debería ver sin lista`);
    assert.equal(canSeePatient(v, null), true);
    assert.equal(canSeePatient(v, undefined), true);
  }
});

test("permitido: quien está en la lista ve (y escribe)", () => {
  assert.equal(canSeePatient(doctorA, ["doc_A"]), true);
  assert.equal(canSeePatient(doctorA, ["doc_B", "doc_A", "rec_1"]), true);
});

test("denegado: quien NO está en la lista no ve — la escritura debe dar el mismo 404", () => {
  assert.equal(canSeePatient(doctorB, ["doc_A"]), false);
  assert.equal(canSeePatient(recep, ["doc_A"]), false);
});

test("admin siempre pasa (ADMIN y SUPER_ADMIN), aunque no esté en la lista", () => {
  assert.equal(canSeePatient(admin, ["doc_A"]), true);
  assert.equal(canSeePatient(superAdmin, ["doc_A"]), true);
  assert.equal(isVisibilityAdmin("ADMIN"), true);
  assert.equal(isVisibilityAdmin("SUPER_ADMIN"), true);
  assert.equal(isVisibilityAdmin("DOCTOR"), false);
  assert.equal(isVisibilityAdmin("RECEPTIONIST"), false);
  assert.equal(isVisibilityAdmin("READONLY"), false);
});

test("patientVisibilityFilter: null para admins (query intacto), OR isEmpty/has para el resto", () => {
  assert.equal(patientVisibilityFilter(admin), null);
  assert.equal(patientVisibilityFilter(superAdmin), null);

  const f = patientVisibilityFilter(doctorB);
  assert.deepEqual(f, {
    OR: [
      { visibleUserIds: { isEmpty: true } },
      { visibleUserIds: { has: "doc_B" } },
    ],
  });
});

test("patientVisibilityAnd: [] para admin, [filtro] para no-admin (spread en AND, nunca OR)", () => {
  assert.deepEqual(patientVisibilityAnd(admin), []);
  const and = patientVisibilityAnd(doctorA);
  assert.equal(and.length, 1);
  assert.ok(and[0].OR, "el filtro va como UN elemento del AND con su OR interno");
});

test("relatedPatientVisibilityAnd: filtra vía la relación patient; patientNullable deja pasar filas sin paciente", () => {
  assert.deepEqual(relatedPatientVisibilityAnd(admin), []);

  const rel = relatedPatientVisibilityAnd(doctorB);
  assert.deepEqual(rel, [{
    OR: [{ patient: { is: patientVisibilityFilter(doctorB) } }],
  }]);

  const nullable = relatedPatientVisibilityAnd(doctorB, { patientNullable: true });
  assert.deepEqual(nullable[0].OR[1], { patientId: null });

  const custom = relatedPatientVisibilityAnd(doctorB, { field: "paciente" });
  assert.ok(custom[0].OR[0].paciente);
});
