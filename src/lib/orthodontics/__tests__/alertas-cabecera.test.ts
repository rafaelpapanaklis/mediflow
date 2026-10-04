// C-58 (auditoría de uso): la cabecera del caso de ortodoncia enseña las mismas banderas médicas que la ficha.
// Con el código viejo la cabecera recibía solo `alergiasReales(...).join(", ")`: este módulo no existía y las
// banderas del cuestionario (anticoagulantes, embarazo, diabetes, hipertensión) no llegaban.

import { test } from "node:test";
import assert from "node:assert/strict";
import { alertasDeCabeceraOrto, MAX_OTRAS } from "../alertas-cabecera";

test("las cinco banderas del cuestionario llegan a la cabecera de ortodoncia", () => {
  const a = alertasDeCabeceraOrto({
    riskFlags: ["ANTICOAGULANTES", "EMBARAZO", "ALERGIA_PENICILINA", "DIABETES", "HIPERTENSION"],
    allergies: ["Penicilina"],
    chronicConditions: ["Diabetes", "Hipertensión controlada"],
    currentMedications: ["Anticoagulantes"],
  });
  const textos = a.riesgo.map((c) => c.texto.toLowerCase());
  for (const t of ["anticoagulantes", "embarazo", "diabetes", "hipertensi", "penicilina"]) {
    assert.ok(textos.some((x) => x.includes(t)), `falta «${t}» en ${JSON.stringify(textos)}`);
  }
  // Sin repetidos: «Penicilina» del campo de alergias la cubre la bandera; lo mismo diabetes/hipertensión.
  assert.equal(a.riesgo.filter((c) => c.texto.toLowerCase().includes("penicilina")).length, 1);
  assert.equal(a.otras.length, 0);
});

test("«N/A» en alergias no sale como alergia y sin datos no hay chips", () => {
  assert.deepEqual(alertasDeCabeceraOrto({ allergies: ["N/A"] }), { riesgo: [], otras: [], ocultas: 0 });
  assert.deepEqual(alertasDeCabeceraOrto({}), { riesgo: [], otras: [], ocultas: 0 });
});

test("padecimientos y medicación: hasta cuatro a la vista y el resto contado; las alergias siempre todas", () => {
  const a = alertasDeCabeceraOrto({
    allergies: ["Látex", "Ibuprofeno"],
    chronicConditions: ["Asma", "Epilepsia", "Hipotiroidismo"],
    currentMedications: ["Levotiroxina 50 mcg", "Salbutamol", "Valproato"],
  });
  assert.equal(a.riesgo.length, 2);
  assert.equal(a.otras.length, MAX_OTRAS);
  assert.equal(a.ocultas, 6 - MAX_OTRAS);
});
