// ws1-t10, F «Cambio de doctor» — los controles futuros se pasan al doctor nuevo
// sin pisar su agenda.
// Correr: npm run test:orto-cambio-doctor
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repartirControles, seTraslapan } from "../cambio-de-doctor";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const f = (ini: string, fin: string) => ({ startsAt: new Date(`2026-10-01T${ini}:00Z`), endsAt: new Date(`2026-10-01T${fin}:00Z`) });

test("dos franjas contiguas NO se traslapan; una dentro de otra, sí", () => {
  assert.equal(seTraslapan(f("10:00", "10:30"), f("10:30", "11:00")), false);
  assert.equal(seTraslapan(f("10:00", "10:30"), f("10:15", "10:45")), true);
  assert.equal(seTraslapan(f("09:00", "12:00"), f("10:00", "10:30")), true);
});

test("se pasan los controles libres y se dejan los que chocan con el doctor nuevo", () => {
  const { mover, conflicto } = repartirControles(
    [{ id: "a", ...f("10:00", "10:30") }, { id: "b", ...f("11:00", "11:30") }],
    [f("11:15", "12:00")],
  );
  assert.deepEqual(mover.map((c) => c.id), ["a"]);
  assert.deepEqual(conflicto.map((c) => c.id), ["b"]);
});

test("dos controles del mismo caso que se pisan entre sí: solo pasa el primero", () => {
  const { mover, conflicto } = repartirControles([{ id: "a", ...f("10:00", "10:30") }, { id: "b", ...f("10:15", "10:45") }], []);
  assert.deepEqual(mover.map((c) => c.id), ["a"]);
  assert.deepEqual(conflicto.map((c) => c.id), ["b"]);
});

test("sin controles no hay nada que mover", () => {
  assert.deepEqual(repartirControles([], [f("10:00", "11:00")]), { mover: [], conflicto: [] });
});

test("la acción usa el caso y la clínica de la sesión, repite el filtro al mover y NO exporta el helper con clinicId", () => {
  const a = leer("app/actions/orthodontics/moverControlesFuturosAlDoctor.ts");
  assert.match(a, /where: \{ id: args\.treatmentPlanId, clinicId: ctx\.clinicId, deletedAt: null \}/);
  assert.match(a, /where: \{ id: c\.id, clinicId: ctx\.clinicId, doctorId: \{ not: plan\.treatingDoctorId \}, status: \{ in:/);
  assert.doesNotMatch(a, /export async function controlesConOtroDoctor/);
  const lib = leer("lib/orthodontics/controles-con-otro-doctor-db.ts");
  assert.match(lib, /if \(!clinicId \|\| !patientId \|\| !treatingDoctorId\) return \[\];/);
});

test("guardar el caso avisa cuántos controles quedaron con el doctor anterior y la ficha ofrece pasarlos", () => {
  const u = leer("app/actions/orthodontics/updateTreatmentPlan.ts");
  assert.match(u, /controlesConOtroDoctor: controlesFuturosConOtroDoctor/);
  const tab = leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx");
  assert.match(tab, /moverControlesFuturosAlDoctor\(\{ treatmentPlanId/);
});
