// H24 (QA ws1-t9): «Nuevo consentimiento» defaulteaba el profesional al
// usuario conectado y el representante legal salía en blanco aunque el caso
// ya tuviera doctor tratante/tutor registrados. Ver ../default-signer.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConsentDoctorId, labelParentesco, type DoctorOption } from "../default-signer";

const DOCTORES: DoctorOption[] = [
  { id: "doc_mariana", firstName: "Mariana", lastName: "Cortés" },
  { id: "doc_renata", firstName: "Renata", lastName: "Solís" },
];

test("EL CASO QUE FALLABA HOY: hay doctor tratante en el caso — gana sobre el usuario conectado", () => {
  const id = resolveConsentDoctorId(DOCTORES, "doc_renata", "doc_mariana");
  assert.equal(id, "doc_renata");
});

test("sin doctor tratante: cae al usuario conectado si es doctor de la clínica (comportamiento de siempre)", () => {
  const id = resolveConsentDoctorId(DOCTORES, null, "doc_mariana");
  assert.equal(id, "doc_mariana");
});

test("doctor tratante ya no existe en la lista de la clínica: no se inventa, cae al usuario conectado", () => {
  const id = resolveConsentDoctorId(DOCTORES, "doc_ya_no_existe", "doc_mariana");
  assert.equal(id, "doc_mariana");
});

test("sin doctor tratante y el usuario conectado no es doctor: cae al primero de la lista", () => {
  const id = resolveConsentDoctorId(DOCTORES, null, "recepcion_1");
  assert.equal(id, "doc_mariana");
});

test("sin doctores en la clínica: cadena vacía, no truena", () => {
  assert.equal(resolveConsentDoctorId([], null, "u1"), "");
});

test("labelParentesco traduce las claves del schema a español legible", () => {
  assert.equal(labelParentesco("madre"), "Madre");
  assert.equal(labelParentesco("tutor_legal"), "Tutor legal");
  assert.equal(labelParentesco("tia"), "Tía");
});

test("labelParentesco con una clave desconocida la devuelve tal cual (no revienta)", () => {
  assert.equal(labelParentesco("clave-nueva-sin-mapear"), "clave-nueva-sin-mapear");
});
