// ws1-t10 — firmar (y guardar borrador de) la hoja de control respeta la visibilidad por paciente.
// Un doctor con pacientes restringidos no firma la hoja de un paciente que no ve, aunque
// conozca el id del caso. Correr: npx tsx --test src/lib/orthodontics/__tests__/firma-visibilidad.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canSeePatient } from "@/lib/patient-visibility";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("la regla de visibilidad que se usa: un doctor fuera de la lista del paciente restringido no lo ve", () => {
  const doctorAjeno = { userId: "doc-2", role: "DOCTOR", clinicId: "c1" } as const;
  const doctorDelCaso = { userId: "doc-1", role: "DOCTOR", clinicId: "c1" } as const;
  assert.equal(canSeePatient(doctorAjeno as any, ["doc-1"]), false);
  assert.equal(canSeePatient(doctorDelCaso as any, ["doc-1"]), true);
  assert.equal(canSeePatient(doctorAjeno as any, []), true); // sin restricción, lo ve todo el equipo
});

for (const archivo of ["signTreatmentCard", "saveTreatmentCardDraft"]) {
  test(`${archivo}: comprueba la visibilidad del paciente ANTES de tocar la cita o la hoja`, () => {
    const src = leer(`app/actions/orthodontics/${archivo}.ts`);
    const iPlan = src.indexOf('return fail("Plan no encontrado")');
    const iVisible = src.indexOf("loadPatientForOrtho({ ctx, patientId: plan.patientId })");
    const iCita = src.indexOf("prisma.appointment.findFirst");
    assert.ok(iPlan > 0 && iVisible > iPlan, "la visibilidad se comprueba justo después de hallar el plan");
    assert.ok(iCita > iVisible, "y antes de buscar la cita");
    assert.match(src.slice(iVisible, iVisible + 160), /if \(isFailure\(visible\)\) return visible;/);
  });
}

test("loadPatientForOrtho usa canSeePatient con el paciente de la clínica de la sesión y contesta lo mismo que «no existe»", () => {
  const h = leer("app/actions/orthodontics/_helpers.ts");
  assert.match(h, /if \(patient\.clinicId !== args\.ctx\.clinicId\) return fail\("Sin acceso a este paciente"\);/);
  assert.match(h, /canSeePatient\(\s*\{ userId: args\.ctx\.userId, role: args\.ctx\.role, clinicId: args\.ctx\.clinicId \},\s*patient\.visibleUserIds,\s*\)/);
});
