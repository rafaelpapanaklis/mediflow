// ws1-t8 #3 — «Nueva cita»: control de ortodoncia propone al doctor tratante del caso y avisa si se elige otro.
// Correr: npx tsx --test src/lib/orthodontics/__tests__/doctor-tratante-cita.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avisarOtroDoctor, doctorAProponer, esMotivoDeControlOrto, type EntradaDoctorTratante } from "../doctor-tratante-cita";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const base: EntradaDoctorTratante = {
  motivo: "Control de ortodoncia",
  casoActivo: true,
  tratanteId: "dr-b",
  doctoresIds: ["dr-a", "dr-b"],
  doctorActual: "dr-a",
};

test("control + caso activo + tratante elegible: propone al tratante y avisa mientras siga el otro", () => {
  assert.equal(doctorAProponer(base), "dr-b");
  assert.equal(avisarOtroDoctor(base), true);
});

test("ya está el tratante: no cambia nada ni avisa", () => {
  const e = { ...base, doctorActual: "dr-b" };
  assert.equal(doctorAProponer(e), null);
  assert.equal(avisarOtroDoctor(e), false);
});

test("otro motivo (Valoración, limpieza…): no propone ni avisa", () => {
  for (const motivo of ["Valoración de ortodoncia", "Limpieza", ""]) {
    assert.equal(doctorAProponer({ ...base, motivo }), null, motivo);
    assert.equal(avisarOtroDoctor({ ...base, motivo }), false, motivo);
  }
});

test("sin caso activo o sin tratante: no propone", () => {
  assert.equal(doctorAProponer({ ...base, casoActivo: false }), null);
  assert.equal(doctorAProponer({ ...base, tratanteId: null }), null);
});

test("un tratante que no está entre los doctores elegibles (inactivo, otra sede) no se propone", () => {
  const e = { ...base, tratanteId: "dr-x" };
  assert.equal(doctorAProponer(e), null);
  assert.equal(avisarOtroDoctor(e), false);
});

test("el motivo se reconoce sin importar mayúsculas ni acentos", () => {
  assert.equal(esMotivoDeControlOrto("control de ortodoncia"), true);
  assert.equal(esMotivoDeControlOrto(" CONTROL DE ORTODONCIA "), true);
  assert.equal(esMotivoDeControlOrto("Control"), false);
});

test("el endpoint devuelve el tratante y la ventana lo usa sin pisar una elección a mano", () => {
  assert.match(leer("src/app/api/orthodontics/context/route.ts"), /treatingDoctorId: plan\?\.treatingDoctorId \?\? null/);
  const d = leer("src/components/dashboard/new-appointment/new-appointment-dialog.tsx");
  assert.match(d, /body\?\.treatingDoctorId/);
  assert.match(d, /doctorAProponer\(entradaTratante\)/);
  assert.match(d, /doctorTocadoAMano\.current = true; setDoctorId\(e\.target\.value\)/, "elegir a mano se respeta");
  assert.match(d, /if \(doctorTocadoAMano\.current \|\| slotIso\) return;/, "con hueco elegido de la agenda no lo cambia solo");
});
