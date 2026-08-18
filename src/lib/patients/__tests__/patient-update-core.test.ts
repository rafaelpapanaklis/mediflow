/**
 * PAC-01 · Editar un paciente NO puede borrarle la diabetes.
 *
 * Run: npm run test:patient-update
 *
 * El PUT de /api/patients/[id] hacía `patientSchema.parse(body)` y esparcía el
 * resultado sobre un `prisma.patient.update`. Los cuatro arrays clínicos
 * llevaban `.default([])`, y el modal de edición no manda tres de ellos, así que
 * zod rellenaba con `[]` y Prisma los escribía vacíos: corregir un teléfono
 * borraba padecimientos crónicos y medicación actual — los mismos datos que lee
 * el chequeo de contraindicaciones al recetar.
 *
 * Estos tests fijan las DOS mitades del contrato, porque arreglar solo una lo
 * rompe por el otro lado:
 *   1. campo AUSENTE  ⇒ `undefined` ⇒ Prisma no toca la columna.
 *   2. campo `[]` EXPLÍCITO ⇒ se escribe `[]` ⇒ el usuario sí puede vaciar la
 *      lista borrando el último elemento a mano.
 *
 * La prueba del 1 sería vacía sin la del 2: un arreglo que se limitara a no
 * escribir nunca los arrays también pasaría la primera y dejaría un no-op nuevo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { patientUpdateData, parsePatientUpdate } from "../patient-update-core";

/** Lo que manda HOY el modal "Editar paciente" (patient-detail-client.tsx:3359):
 *  `{...editForm, allergies, curp, curpStatus, passportNo}`. editForm NO lleva
 *  chronicConditions, currentMedications ni tags. */
function bodyDelModalDeEdicion(over: Record<string, any> = {}) {
  return {
    firstName: "Ana",
    lastName: "Ruiz",
    email: "ana@example.com",
    phone: "5512345678",
    dob: "1990-01-01",
    gender: "F",
    address: "Calle 1",
    allergies: ["penicilina"],
    curp: null,
    curpStatus: "PENDING",
    passportNo: null,
    notes: "nota",
    familyHistory: null,
    personalNonPathologicalHistory: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelation: null,
    ...over,
  };
}

const CLINICOS = ["chronicConditions", "currentMedications", "tags"] as const;

// ── 1 · El fallo de PAC-01, campo por campo ──────────────────────────

for (const campo of CLINICOS) {
  test(`un PUT sin ${campo} NO lo vacia`, () => {
    const { data } = parsePatientUpdate(bodyDelModalDeEdicion());
    assert.equal(
      data[campo],
      undefined,
      `${campo} llego como ${JSON.stringify(data[campo])}; con cualquier valor distinto de undefined Prisma escribe la columna`,
    );
    // El caso concreto que rompia produccion: NUNCA un array vacio.
    assert.notDeepEqual(data[campo], []);
  });
}

test("el body real del modal de edicion no toca ninguno de los tres arrays que no manda", () => {
  const { data } = parsePatientUpdate(bodyDelModalDeEdicion());
  for (const campo of CLINICOS) assert.equal(campo in data ? data[campo] : undefined, undefined);
  // allergies SI lo manda el modal, y debe escribirse tal cual.
  assert.deepEqual(data.allergies, ["penicilina"]);
});

test("REFUTACION: el schema ya no inventa arrays vacios para los campos ausentes", () => {
  // Si alguien devuelve `.default([])` a patientSchema, este test cae aunque
  // patientUpdateData siga igual. Es el candado sobre la causa raiz.
  const { parsed } = parsePatientUpdate(bodyDelModalDeEdicion());
  for (const campo of CLINICOS) {
    assert.equal(
      (parsed as Record<string, unknown>)[campo],
      undefined,
      `patientSchema volvio a rellenar ${campo}`,
    );
  }
});

// ── 2 · La otra mitad: vaciar a proposito SI funciona ────────────────

for (const campo of CLINICOS) {
  test(`un PUT con ${campo}: [] SI lo vacia`, () => {
    const { data } = parsePatientUpdate(bodyDelModalDeEdicion({ [campo]: [] }));
    assert.deepEqual(data[campo], [], `${campo} explicito vacio debe escribirse`);
  });
}

test("los arrays con valor se escriben tal cual", () => {
  const { data } = parsePatientUpdate(
    bodyDelModalDeEdicion({
      chronicConditions: ["diabetes tipo 2", "hipertension"],
      currentMedications: ["metformina 850mg", "warfarina"],
      tags: ["VIP"],
    }),
  );
  assert.deepEqual(data.chronicConditions, ["diabetes tipo 2", "hipertension"]);
  assert.deepEqual(data.currentMedications, ["metformina 850mg", "warfarina"]);
  assert.deepEqual(data.tags, ["VIP"]);
});

// ── 3 · Misma clase de fallo en `gender` ─────────────────────────────

test("un PUT sin gender NO reescribe el genero a OTHER", () => {
  const sinGenero = bodyDelModalDeEdicion();
  delete (sinGenero as Record<string, unknown>).gender;
  const { data } = parsePatientUpdate(sinGenero);
  assert.equal(data.gender, undefined);
});

test("el gender que manda el modal se respeta", () => {
  const { data } = parsePatientUpdate(bodyDelModalDeEdicion({ gender: "M" }));
  assert.equal(data.gender, "M");
});

// ── 4 · Normalizaciones que ya existian y no deben cambiar ───────────

test("dob ausente o vacio deja la fecha intacta; con valor se convierte a Date", () => {
  const sinDob = bodyDelModalDeEdicion();
  delete (sinDob as Record<string, unknown>).dob;
  assert.equal(parsePatientUpdate(sinDob).data.dob, undefined);
  assert.equal(parsePatientUpdate(bodyDelModalDeEdicion({ dob: "" })).data.dob, undefined);
  const conDob = parsePatientUpdate(bodyDelModalDeEdicion({ dob: "1990-01-01" })).data.dob;
  assert.ok(conDob instanceof Date);
  assert.equal((conDob as Date).toISOString().slice(0, 10), "1990-01-01");
});

test("email vacio no guarda cadena vacia", () => {
  assert.equal(parsePatientUpdate(bodyDelModalDeEdicion({ email: "" })).data.email, undefined);
});

test("curp con valor se normaliza; null explicito la borra; ausente la deja", () => {
  // Sin espacios alrededor: `patientSchema` mide max(18) ANTES del trim, así que
  // " curp " (20 chars) lo rechaza el propio schema. Comportamiento previo, no
  // se toca aquí; el test solo comprueba el paso a mayúsculas.
  assert.equal(
    parsePatientUpdate(bodyDelModalDeEdicion({ curp: "ruaa900101mdfxxx01", curpStatus: "COMPLETE" })).data.curp,
    "RUAA900101MDFXXX01",
  );
  assert.equal(parsePatientUpdate(bodyDelModalDeEdicion({ curp: null })).data.curp, null);
  const sinCurp = bodyDelModalDeEdicion();
  delete (sinCurp as Record<string, unknown>).curp;
  assert.equal(parsePatientUpdate(sinCurp).data.curp, undefined);
});

// ── 5 · El schema sigue validando lo que validaba ────────────────────

test("sigue rechazando un nombre de menos de 2 caracteres", () => {
  assert.throws(() => parsePatientUpdate(bodyDelModalDeEdicion({ firstName: "A" })));
});

test("sigue descartando claves que no estan en el schema (no llegan al update)", () => {
  const { data } = parsePatientUpdate(bodyDelModalDeEdicion({ clinicId: "otra_clinica", patientNumber: "P-9999" }));
  assert.equal("clinicId" in data, false);
  assert.equal("patientNumber" in data, false);
});

test("patientUpdateData sobre un objeto ya parseado es puro (no muta la entrada)", () => {
  const parsed = { firstName: "Ana", lastName: "Ruiz", dob: "1990-01-01" } as any;
  const copia = JSON.parse(JSON.stringify(parsed));
  patientUpdateData(parsed);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), copia);
});
