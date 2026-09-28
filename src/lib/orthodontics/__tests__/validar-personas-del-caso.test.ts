/**
 * X1 — responsable del pago, doctor tratante y doctor que refirió se validan
 * contra la clínica de la sesión antes de guardarse.
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/validar-personas-del-caso.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MENSAJE_PERSONA_AJENA,
  idsPorComprobar,
  motivoPersonaAjena,
} from "../validar-personas-del-caso";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("vacíos y null no se comprueban (quitar a la persona siempre se puede)", () => {
  assert.deepEqual(idsPorComprobar({ responsibleGuardianId: null, treatingDoctorId: undefined, referredByDoctorId: "" }), {});
});

test("lo que ya estaba guardado con el mismo valor no se re-valida; un valor nuevo sí", () => {
  assert.deepEqual(
    idsPorComprobar(
      { treatingDoctorId: "doc-1", responsibleGuardianId: "g-2" },
      { treatingDoctorId: "doc-1", responsibleGuardianId: "g-1" },
    ),
    { responsibleGuardianId: "g-2" },
  );
});

test("un id ajeno da el mensaje de ESA persona; todo encontrado da null", () => {
  const pedidas = { responsibleGuardianId: "g", treatingDoctorId: "d", referredByDoctorId: "r" };
  assert.equal(
    motivoPersonaAjena(pedidas, { responsibleGuardianId: true, treatingDoctorId: false, referredByDoctorId: true }),
    MENSAJE_PERSONA_AJENA.treatingDoctorId,
  );
  assert.equal(
    motivoPersonaAjena(pedidas, { responsibleGuardianId: true, treatingDoctorId: true, referredByDoctorId: false }),
    MENSAJE_PERSONA_AJENA.referredByDoctorId,
  );
  assert.equal(
    motivoPersonaAjena(pedidas, { responsibleGuardianId: false, treatingDoctorId: false }),
    MENSAJE_PERSONA_AJENA.responsibleGuardianId,
  );
  assert.equal(motivoPersonaAjena(pedidas, { responsibleGuardianId: true, treatingDoctorId: true, referredByDoctorId: true }), null);
});

test("lo no pedido no cuenta aunque la base no lo encuentre", () => {
  assert.equal(motivoPersonaAjena({ treatingDoctorId: "d" }, { treatingDoctorId: true, responsibleGuardianId: false }), null);
});

test("sin respuesta de la base = ajena (falla cerrado)", () => {
  assert.equal(motivoPersonaAjena({ responsibleGuardianId: "g" }, {}), MENSAJE_PERSONA_AJENA.responsibleGuardianId);
});

test("la consulta corta sin clínica y filtra tutor por clínica (compartido entre hermanos), referidor por clínica", () => {
  const db = leer("lib/orthodontics/validar-personas-del-caso-db.ts");
  assert.match(db, /if \(!clinicId \|\| !patientId\) return MENSAJE_SIN_CLINICA;/);
  assert.match(db, /id: porComprobar\.responsibleGuardianId, clinicId, deletedAt: null/);
  assert.match(db, /esDoctorTratanteDeLaClinica\(clinicId, porComprobar\.treatingDoctorId\)/);
  assert.match(db, /id: porComprobar\.referredByDoctorId, clinicId, deletedAt: null/);
});

test("el doctor que refirió se valida al crear y al editar el diagnóstico", () => {
  for (const f of ["createDiagnosis", "updateDiagnosis"]) {
    const src = leer(`app/actions/orthodontics/${f}.ts`);
    assert.match(src, /validarPersonasDelCaso\(\{[\s\S]*?clinicId: ctx\.clinicId,[\s\S]*?referredByDoctorId: parsed\.data\.referredByDoctorId/, f);
    assert.match(src, /if \(personaAjena\) return fail\(personaAjena\);/, f);
  }
});
