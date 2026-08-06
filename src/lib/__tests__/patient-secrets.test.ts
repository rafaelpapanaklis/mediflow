/**
 * `portalToken` fuera del payload (Ola crítica · P1-N1).
 *
 * Run: npm run test:patient-secrets
 *
 * `Patient.portalToken` es el bearer de /portal/[token]: con él se abre el
 * expediente SIN sesión y el link sobrevive a que le revoquen la cuenta de staff
 * a quien lo copió. Viajaba al navegador en 7 superficies (la ficha por API, la
 * ficha SSR, la lista, el buscador legacy, POST/PUT/PATCH de pacientes y las dos
 * rutas de facturas con `include: { patient: true }`), todas por serializar la
 * fila completa.
 *
 * Estos tests fijan el contrato del punto único donde se quita.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripPatientSecrets,
  stripNestedPatientSecrets,
  PATIENT_SECRET_FIELD_NAMES,
} from "../patient-secrets";

/** Una fila de Patient como la devuelve un findFirst sin `select`. */
function patientRow(over: Record<string, any> = {}) {
  return {
    id: "pat_1",
    clinicId: "cli_1",
    firstName: "Ana",
    lastName: "Ruiz",
    patientNumber: "P-0001",
    email: "ana@example.com",
    curp: "RUAA900101MDFXXX01",
    notes: "nota interna",
    portalToken: "tok_secreto_permanente",
    portalTokenExpiry: new Date("2027-01-01T00:00:00.000Z"),
    ...over,
  };
}

test("portalToken y portalTokenExpiry no sobreviven", () => {
  const out = stripPatientSecrets(patientRow()) as Record<string, any>;
  assert.equal("portalToken" in out, false);
  assert.equal("portalTokenExpiry" in out, false);
});

test("el resto de la ficha llega intacto", () => {
  const out = stripPatientSecrets(patientRow()) as Record<string, any>;
  assert.equal(out.id, "pat_1");
  assert.equal(out.firstName, "Ana");
  assert.equal(out.patientNumber, "P-0001");
  // PII que la ficha SÍ muestra y edita: no es credencial, no se toca. Su
  // control es la visibilidad por paciente, no este helper.
  assert.equal(out.curp, "RUAA900101MDFXXX01");
  assert.equal(out.notes, "nota interna");
  assert.equal(out.email, "ana@example.com");
});

test("no muta el objeto original (el server sigue pudiendo armar el portalUrl)", () => {
  // La ficha SSR arma `portalUrl` con el token ANTES de mandar el paciente al
  // cliente. Si el helper mutara, el link del portal se rompería.
  const row = patientRow();
  stripPatientSecrets(row);
  assert.equal(row.portalToken, "tok_secreto_permanente");
});

test("una lista completa queda limpia fila por fila", () => {
  // El caso de /api/patients: 50 filas completas por página.
  const rows = [patientRow({ id: "a" }), patientRow({ id: "b" }), patientRow({ id: "c" })];
  const out = stripPatientSecrets(rows) as Array<Record<string, any>>;
  assert.equal(out.length, 3);
  for (const r of out) assert.equal("portalToken" in r, false);
  assert.deepEqual(out.map((r) => r.id), ["a", "b", "c"]);
});

test("acepta null/undefined sin reventar (findFirst directo)", () => {
  assert.equal(stripPatientSecrets(null), null);
  assert.equal(stripPatientSecrets(undefined), undefined);
});

test("stripNestedPatientSecrets limpia el paciente colgado de una factura", () => {
  // El caso de `include: { patient: true }` en /api/invoices y /api/invoices/[id].
  const invoice = {
    id: "inv_1",
    invoiceNumber: "INV-2026-0007",
    total: 1200,
    patient: patientRow(),
    payments: [{ id: "pay_1", amount: 1200 }],
  };
  const out = stripNestedPatientSecrets(invoice) as any;
  assert.equal("portalToken" in out.patient, false);
  assert.equal("portalTokenExpiry" in out.patient, false);
  // La factura entera sigue ahí.
  assert.equal(out.invoiceNumber, "INV-2026-0007");
  assert.equal(out.total, 1200);
  assert.equal(out.payments.length, 1);
  // Y el original no se mutó.
  assert.equal(invoice.patient.portalToken, "tok_secreto_permanente");
});

test("stripNestedPatientSecrets tolera una entidad sin paciente", () => {
  const row = { id: "inv_2", patientId: null, patient: null };
  assert.deepEqual(stripNestedPatientSecrets(row), row);
  assert.deepEqual(stripNestedPatientSecrets({ id: "x" }), { id: "x" });
});

test("stripNestedPatientSecrets funciona sobre un arreglo de facturas", () => {
  const out = stripNestedPatientSecrets([
    { id: "i1", patient: patientRow() },
    { id: "i2", patient: patientRow() },
  ]) as Array<any>;
  assert.equal(out.length, 2);
  for (const inv of out) assert.equal("portalToken" in inv.patient, false);
});

test("la lista de campos secretos es la esperada", () => {
  // Si alguien agrega un campo credencial a Patient y lo mete aquí, este test
  // le recuerda que también hay que cubrirlo; si lo QUITA, salta.
  assert.deepEqual([...PATIENT_SECRET_FIELD_NAMES].sort(), [
    "portalToken",
    "portalTokenExpiry",
  ]);
});
