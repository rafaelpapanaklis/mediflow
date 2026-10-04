// C-60 / C-61 (auditoría de uso): «en Mérida» con una clínica de CDMX. Los datos reales de la clínica de prueba:
// ciudad «Mérida», dirección «Av. Insurgentes Sur 1234, Col. Del Valle, Benito Juárez, 03100 Ciudad de México, CDMX».
// Con el código viejo los documentos imprimían el campo ciudad tal cual; este módulo no existía.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ciudadDeLaDireccion, direccionYaDiceLaCiudad, lugarDeLaClinica } from "../lugar-de-la-clinica";

const QA = {
  ciudad: "Mérida",
  estado: null,
  direccion: "Av. Insurgentes Sur 1234, Col. Del Valle, Benito Juárez, 03100 Ciudad de México, CDMX",
};

test("la dirección con código postal manda sobre un campo ciudad que la contradice", () => {
  assert.deepEqual(ciudadDeLaDireccion(QA.direccion), { ciudad: "Ciudad de México", estado: "CDMX" });
  assert.deepEqual(lugarDeLaClinica(QA), { lugar: "Ciudad de México", ciudad: "Ciudad de México", contradice: true });
});

test("si la dirección dice la misma ciudad, se usa el campo de siempre (con su estado)", () => {
  assert.deepEqual(
    lugarDeLaClinica({ ciudad: "Mérida", estado: "Yucatán", direccion: "Calle 60 #491, Centro, 97000 Mérida, Yuc." }),
    { lugar: "Mérida, Yucatán", ciudad: "Mérida", contradice: false },
  );
  assert.deepEqual(lugarDeLaClinica({ ciudad: "CDMX", direccion: QA.direccion }), { lugar: "CDMX", ciudad: "CDMX", contradice: false });
});

test("sin código postal en la dirección, el campo ciudad; sin nada, vacío", () => {
  assert.equal(lugarDeLaClinica({ ciudad: "Puebla", direccion: "Av. Juárez 100" }).lugar, "Puebla");
  assert.equal(lugarDeLaClinica({ ciudad: null, direccion: "Calle 5 de Mayo 12, 72000 Puebla, Pue." }).lugar, "Puebla, Pue");
  assert.equal(lugarDeLaClinica({}).lugar, "");
});

test("un número exterior de 5 cifras no es el código postal", () => {
  assert.deepEqual(ciudadDeLaDireccion("Blvd. Kukulcán 12345, Zona Hotelera, 77500 Cancún, Q. Roo"), { ciudad: "Cancún", estado: "Q. Roo" });
});

test("no se pega a la dirección una ciudad que ya trae", () => {
  assert.equal(direccionYaDiceLaCiudad(QA.direccion, "Ciudad de México"), true);
  assert.equal(direccionYaDiceLaCiudad(QA.direccion, "Mérida"), false);
  assert.equal(direccionYaDiceLaCiudad("Av. Juárez 100", "Puebla"), false);
});
