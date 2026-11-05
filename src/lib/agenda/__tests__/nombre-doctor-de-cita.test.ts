/**
 * La tabla de citas de la ficha del paciente dice «Sin doctor» en una cita sin
 * doctor (ws1-t11, unión · R1). Antes la celda salía vacía.
 *
 * Run: npm run test:cita-sin-doctor-panel
 *
 * PURO, más un ancla en la ficha (la celda usa el ayudante con el texto del
 * diccionario).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TEXTO_SIN_DOCTOR, nombreDoctorDeCita } from "../sin-doctor";

test("🔴 sin doctor: el rótulo, nunca una celda vacía", () => {
  assert.equal(nombreDoctorDeCita(null), TEXTO_SIN_DOCTOR);
  assert.equal(nombreDoctorDeCita(undefined), "Sin doctor");
  assert.equal(nombreDoctorDeCita(null, "No doctor"), "No doctor", "el de la pantalla, ya traducido");
});

test("con doctor, su nombre como siempre", () => {
  assert.equal(nombreDoctorDeCita({ firstName: "Raquel", lastName: "Méndez" }), "Raquel Méndez");
  assert.equal(nombreDoctorDeCita({ firstName: "Raquel", lastName: null }), "Raquel");
  assert.equal(nombreDoctorDeCita({ firstName: null, lastName: null }), "");
});

test("🔴 la ficha del paciente pinta la columna «Doctor» con el ayudante y el texto del diccionario", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
  assert.ok(src.includes('nombreDoctorDeCita(a.doctor, t("agenda.sinDoctor.nombre"))'), "la celda usa el ayudante");
  assert.ok(!src.includes("{a.doctor?.firstName} {a.doctor?.lastName}"), "ya no arma el nombre a mano (salía vacío)");
  const es = JSON.parse(readFileSync(path.join(process.cwd(), "src/i18n/dictionaries/es.json"), "utf8"));
  const en = JSON.parse(readFileSync(path.join(process.cwd(), "src/i18n/dictionaries/en.json"), "utf8"));
  assert.equal(es.agenda.sinDoctor.nombre, "Sin doctor");
  assert.ok(en.agenda.sinDoctor.nombre);
});
