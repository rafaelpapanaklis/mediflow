/**
 * Política del borrado definitivo de un paciente (Ola crítica · P0-1).
 *
 * Run: npm run test:patient-deletion
 *
 * El bug que estos tests cierran: el precheck era una lista de LO QUE BLOQUEA,
 * escrita a mano, con 7 familias clínicas. `Patient` tiene 61 relaciones
 * `onDelete: Cascade`, así que Ortodoncia, Pediatría, Periodoncia y
 * `PatientCredit` (dinero del paciente) se borraban en silencio.
 *
 * El candado central es `cobertura total`: recorre el DMMF de Prisma —el schema
 * REAL, no una lista— y exige que toda relación destructiva a Patient esté
 * decidida. Si alguien agrega una tabla de especialidad y no pasa por la
 * política, este test falla ANTES de que un borrado se lleve el expediente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  CASCADE_ALLOWED,
  BLOCKER_TYPE_BY_MODEL,
  HANDLED_SEPARATELY,
  TRANSITIVE_MONEY,
  classifyPatientRelations,
  isDestructiveRelation,
  summarizeBlockers,
  type PatientRelationModel,
} from "../patient-deletion-policy";

/** Copia local de la lectura del DMMF (el módulo real vive junto a prisma). */
function relationsFromDmmf(): PatientRelationModel[] {
  const out: PatientRelationModel[] = [];
  for (const model of Prisma.dmmf.datamodel.models) {
    const hasClinicId = model.fields.some((f) => f.name === "clinicId");
    for (const field of model.fields) {
      if (field.type !== "Patient") continue;
      if (!field.relationFromFields?.length) continue;
      out.push({
        model: model.name,
        onDelete: ((field as any).relationOnDelete ?? null) as PatientRelationModel["onDelete"],
        required: field.isRequired,
        hasClinicId,
      });
    }
  }
  return out;
}

const rel = (over: Partial<PatientRelationModel> = {}): PatientRelationModel => ({
  model: "X",
  onDelete: "Cascade",
  required: true,
  hasClinicId: true,
  ...over,
});

// ── Qué cuenta como destructivo ──────────────────────────────────────────

test("Cascade y Restrict son destructivos; SetNull y las opcionales no", () => {
  assert.equal(isDestructiveRelation(rel({ onDelete: "Cascade" })), true);
  assert.equal(isDestructiveRelation(rel({ onDelete: "Restrict" })), true);
  assert.equal(isDestructiveRelation(rel({ onDelete: "SetNull", required: false })), false);
  // Una relación OPCIONAL sobrevive con patientId = null: no borra ni bloquea.
  assert.equal(isDestructiveRelation(rel({ onDelete: null, required: false })), false);
});

// ── El criterio invertido ────────────────────────────────────────────────

test("lo que NO está en la allowlist bloquea, aunque nadie lo haya clasificado", () => {
  const { allowed, blocking } = classifyPatientRelations([
    rel({ model: "Appointment" }),        // en la allowlist
    rel({ model: "TablaQueNadieHaVisto" }), // relación NUEVA, sin clasificar
  ]);
  assert.deepEqual(allowed, ["Appointment"]);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].model, "TablaQueNadieHaVisto");
  // Sin tipo asignado cae al comodín, que la UI ya sabe traducir. Fallo CERRADO:
  // el default de una tabla nueva es bloquear, no borrar.
  assert.equal(blocking[0].type, "related");
});

test("Invoice se maneja aparte: no entra al recorrido genérico", () => {
  const { allowed, blocking } = classifyPatientRelations([rel({ model: "Invoice" })]);
  assert.deepEqual(allowed, []);
  assert.deepEqual(blocking, []);
  assert.ok(HANDLED_SEPARATELY.has("Invoice"));
});

test("un modelo con dos FK a Patient se cuenta una sola vez", () => {
  const { blocking } = classifyPatientRelations([
    rel({ model: "MedicalRecord" }),
    rel({ model: "MedicalRecord" }),
  ]);
  assert.equal(blocking.length, 1);
});

test("hasClinicId viaja hasta el blocker (las tablas sin clinicId se scopean por paciente)", () => {
  const { blocking } = classifyPatientRelations([
    rel({ model: "OdontogramEntry", hasClinicId: false }),
    rel({ model: "MedicalRecord", hasClinicId: true }),
  ]);
  assert.equal(blocking.find((b) => b.model === "OdontogramEntry")!.hasClinicId, false);
  assert.equal(blocking.find((b) => b.model === "MedicalRecord")!.hasClinicId, true);
});

// ── El caso de la auditoría, contra el schema REAL ────────────────────────

test("un paciente de ortodoncia con saldo a favor YA NO es borrable", () => {
  const { blocking } = classifyPatientRelations(relationsFromDmmf());
  const byModel = new Map(blocking.map((b) => [b.model, b]));

  // Este es el paciente del hallazgo P0-1: sin factura, sin nota SOAP y sin
  // radiografía pasaba el precheck como deletable:true.
  assert.equal(byModel.get("OrthodonticTreatmentPlan")?.type, "specialty");
  assert.equal(byModel.get("OrthoPhotoSet")?.type, "specialty");
  assert.equal(byModel.get("OrthoTreatmentCard")?.type, "specialty");
  assert.equal(byModel.get("PatientCredit")?.type, "credit");

  // Y las otras dos especialidades completas que se borraban en silencio.
  assert.equal(byModel.get("PediatricRecord")?.type, "specialty");
  assert.equal(byModel.get("PeriodontalTreatmentPlan")?.type, "specialty");

  // Lo que ya bloqueaba antes sigue bloqueando (sin regresión).
  for (const m of [
    "MedicalRecord", "Prescription", "ConsentForm", "PatientFile",
    "XrayAnalysis", "OdontogramEntry", "OdontogramSnapshot",
  ]) {
    assert.equal(byModel.get(m)?.type, "clinical", `${m} debe seguir bloqueando`);
  }
  for (const m of ["EndodonticDiagnosis", "VitalityTest", "EndodonticTreatment"]) {
    assert.equal(byModel.get(m)?.type, "endodontics", `${m} debe seguir bloqueando`);
  }
  for (const m of ["Implant", "ImplantConsent"]) {
    assert.equal(byModel.get(m)?.type, "implants", `${m} debe seguir bloqueando`);
  }
});

test("lo operativo sigue pudiendo borrarse (una ficha de prueba con una cita)", () => {
  const { allowed } = classifyPatientRelations(relationsFromDmmf());
  // Criterio heredado del precheck original: citas, presupuestos, tratamientos
  // y planes de pago NO son expediente. Si esto cambia, es una decisión, no un
  // accidente — y el test lo obliga a ser explícita.
  for (const m of ["Appointment", "Quote", "TreatmentPlan", "PaymentPlan", "WaitlistEntry"]) {
    assert.ok(allowed.includes(m), `${m} debería seguir siendo borrable`);
  }
});

test("COBERTURA TOTAL: ninguna relación destructiva del schema queda sin decidir", () => {
  const relations = relationsFromDmmf();
  const destructive = relations.filter(isDestructiveRelation);

  // Sanity: si esto baja de golpe es que el DMMF dejó de exponer relationOnDelete
  // y el precheck se habría quedado ciego sin avisar.
  assert.ok(
    destructive.length >= 60,
    `esperaba ~66 relaciones destructivas a Patient, encontré ${destructive.length}`,
  );

  const sinDecidir = Array.from(new Set(destructive.map((r) => r.model)))
    .filter((m) => !HANDLED_SEPARATELY.has(m))
    .filter((m) => !Object.prototype.hasOwnProperty.call(CASCADE_ALLOWED, m))
    .filter((m) => !Object.prototype.hasOwnProperty.call(BLOCKER_TYPE_BY_MODEL, m));

  assert.deepEqual(
    sinDecidir,
    [],
    `Modelos con relación destructiva a Patient sin decidir en la política.\n` +
      `Decidí uno por uno en src/lib/patient-deletion-policy.ts:\n` +
      `  · si puede morir con el paciente → CASCADE_ALLOWED (con el porqué)\n` +
      `  · si debe conservarse           → BLOCKER_TYPE_BY_MODEL (con su tipo)\n` +
      `Sin decidir bloquean igual (fallo cerrado), pero con un mensaje genérico.\n` +
      `Faltan: ${sinDecidir.join(", ")}`,
  );
});

test("el punto ciego transitivo está cubierto: la mensualidad COBRADA bloquea", () => {
  // La refutación del PR encontró esto: `PaymentPlan` está en la allowlist
  // (un calendario no es dinero), pero `PlanPayment` —el pago ya recibido—
  // cuelga del PLAN, no del paciente. Al no tener `patientId` es INVISIBLE para
  // la enumeración del DMMF, así que un paciente que pagó en mensualidades sin
  // factura salía `deletable: true` y sus pagos morían en silencio: justo lo
  // que la inversión del criterio venía a impedir.
  const rels = relationsFromDmmf();
  const directos = new Set(rels.map((r) => r.model));

  for (const t of TRANSITIVE_MONEY) {
    assert.equal(
      directos.has(t.model),
      false,
      `${t.model} SÍ tiene FK directa a Patient: sácalo de TRANSITIVE_MONEY y clasifícalo normal`,
    );
    // Y su dueño debe seguir en la allowlist: si alguien lo mueve a bloqueante,
    // el conteo transitivo pasa a ser redundante y hay que quitarlo.
    assert.ok(
      Object.keys(CASCADE_ALLOWED).length > 0,
      "la allowlist no puede quedar vacía",
    );
  }

  // El caso concreto: PlanPayment cuelga de PaymentPlan, que sí es borrable.
  assert.ok(TRANSITIVE_MONEY.some((t) => t.model === "PlanPayment" && t.type === "credit"));
  assert.ok(Object.prototype.hasOwnProperty.call(CASCADE_ALLOWED, "PaymentPlan"));
});

test("la allowlist y el mapa de tipos no se pisan", () => {
  const dobles = Object.keys(CASCADE_ALLOWED).filter((m) =>
    Object.prototype.hasOwnProperty.call(BLOCKER_TYPE_BY_MODEL, m),
  );
  assert.deepEqual(dobles, [], `clasificados como borrables Y bloqueantes: ${dobles.join(", ")}`);
});

test("la política no clasifica modelos que ya no existen en el schema", () => {
  const reales = new Set(relationsFromDmmf().map((r) => r.model));
  const fantasmas = [
    ...Object.keys(CASCADE_ALLOWED),
    ...Object.keys(BLOCKER_TYPE_BY_MODEL),
  ].filter((m) => !reales.has(m));
  assert.deepEqual(fantasmas, [], `modelos en la política que ya no existen: ${fantasmas.join(", ")}`);
});

// ── Agrupado para la UI ──────────────────────────────────────────────────

test("summarizeBlockers suma por tipo, descarta los ceros y ordena fijo", () => {
  const out = summarizeBlockers([
    { type: "specialty", count: 3 },
    { type: "clinical", count: 0 },
    { type: "invoices", count: 2 },
    { type: "specialty", count: 4 },
    { type: "credit", count: 1 },
  ]);
  assert.deepEqual(out, [
    { type: "invoices", count: 2 },
    { type: "credit", count: 1 },
    { type: "specialty", count: 7 },
  ]);
});

test("sin nada que bloquear, el paciente es borrable", () => {
  assert.deepEqual(summarizeBlockers([{ type: "clinical", count: 0 }]), []);
  assert.deepEqual(summarizeBlockers([]), []);
});
