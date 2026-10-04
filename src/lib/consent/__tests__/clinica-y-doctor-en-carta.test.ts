// C-61 (auditoría de uso): la carta decía «Lugar y fecha: Mérida» con «Dirección: … 03100 Ciudad de México, CDMX,
// Mérida», y «Especialidad: ____» para un doctor con «Ortodoncia» en Mi perfil. Datos reales de la clínica de prueba.
// Con el código viejo la carta tomaba `clinic.city` y `User.especialidad` tal cual (este módulo no existía).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ciudadParaCarta, especialidadParaCarta } from "../clinica-y-doctor-en-carta";
import { buildConsentContent } from "../templates";

const CLINICA = {
  name: "Clínica de Prueba QA",
  city: "Mérida",
  address: "Av. Insurgentes Sur 1234, Col. Del Valle, Benito Juárez, 03100 Ciudad de México, CDMX",
};

test("la ciudad de la carta no contradice la dirección", () => {
  assert.equal(ciudadParaCarta(CLINICA), "Ciudad de México");
  assert.equal(ciudadParaCarta({ city: "Mérida", address: "Calle 60 #491, 97000 Mérida, Yuc." }), "Mérida");
  assert.equal(ciudadParaCarta(null), null);
});

test("la especialidad: la oficial; si falta, la de Equipo/Mi perfil si es de la lista", () => {
  assert.equal(especialidadParaCarta({ especialidad: "Ortodoncia y Ortopedia Dentofacial", specialty: "Ortodoncia" }), "Ortodoncia y Ortopedia Dentofacial");
  assert.equal(especialidadParaCarta({ especialidad: null, specialty: "Odontología General" }), "Odontología General");
  // El registro guarda la categoría («orthodontics»): se lee como su valor de la lista.
  assert.equal(especialidadParaCarta({ especialidad: "", specialty: "orthodontics" }), "Ortodoncia");
  assert.equal(especialidadParaCarta({ especialidad: null, specialty: "Otra" }), null);
  assert.equal(especialidadParaCarta({ especialidad: null, specialty: "algo raro" }), null);
  assert.equal(especialidadParaCarta(null), null);
});

test("la carta completa: «Lugar y fecha: Ciudad de México» y la dirección sin «, Mérida» pegado", () => {
  const carta = buildConsentContent("resina", {
    fullIdentification: true,
    clinicName: CLINICA.name,
    clinicAddress: CLINICA.address,
    clinicCity: ciudadParaCarta(CLINICA),
    patientName: "Ana María Prueba Dos",
    doctorName: "Cuenta de Prueba",
    doctorLicense: "7654321",
    doctorSpecialty: especialidadParaCarta({ especialidad: null, specialty: "Odontología General" }),
    date: "3 de octubre de 2026",
  });
  assert.match(carta, /Lugar y fecha: Ciudad de México, a 3 de octubre de 2026/);
  assert.ok(!carta.includes("Mérida"), "la carta todavía dice Mérida");
  assert.ok(!/CDMX, Ciudad de México/.test(carta), "pegó la ciudad a una dirección que ya la trae");
  assert.match(carta, /Especialidad: Odontología General/);
});
