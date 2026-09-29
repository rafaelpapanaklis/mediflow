import test from "node:test";
import assert from "node:assert/strict";
import { esOrtodonciaDentalink, prestacionEsOrtodoncia, renglonEsOrtodoncia } from "../dentalink/es-ortodoncia";

const r = (categoria: string, prestacion: string, especialidad = "Odontología General") => ({
  "Nombre Categoría": categoria,
  "Nombre Prestación": prestacion,
  "Especialidad Profesional Tratamiento": especialidad,
});

test("la categoría Ortodoncia, sin acentos ni mayúsculas, basta", () => {
  assert.equal(esOrtodonciaDentalink([r("Ortodoncia", "Control mensual")]), true);
  assert.equal(esOrtodonciaDentalink([r(" ORTODONCIA ", "x")]), true);
  assert.equal(esOrtodonciaDentalink([r("Ortodóncia", "x")]), true); // el acento no cuenta
});

test("la prestación con palabras de ortodoncia basta", () => {
  for (const p of ["Instalación de Brackets metálicos", "Alineadores invisibles", "Sistema Damon Q", "Retenedor de contención", "Colocación de TADs", "Tad interradicular"]) {
    assert.equal(esOrtodonciaDentalink([r("Operatoria", p)]), true, p);
  }
});

test("la especialidad del profesional Ortodoncia basta solo si el renglón no trae categoría", () => {
  assert.equal(esOrtodonciaDentalink([r("", "Resina", "Ortodoncia")]), true);
  assert.equal(esOrtodonciaDentalink([r("", "Resina", "Ortodoncista")]), true);
  // Con categoría propia manda la categoría: un ortodoncista también hace operatoria (BEVADENT: 100 tratamientos).
  assert.equal(esOrtodonciaDentalink([r("Operatoria", "Resina", "Ortodoncia")]), false);
});

test("con un solo renglón de ortodoncia todo el tratamiento lo es", () => {
  assert.equal(esOrtodonciaDentalink([r("Operatoria", "Resina"), r("Ortodoncia", "Control")]), true);
});

test("dental común no es ortodoncia; nada de falsos positivos por subcadenas", () => {
  assert.equal(esOrtodonciaDentalink([r("Operatoria", "Resina compuesta"), r("Cirugía", "Extracción")]), false);
  assert.equal(esOrtodonciaDentalink([r("Endodoncia", "Estadio de tratamiento")]), false); // «tad» dentro de «estadio»
  assert.equal(esOrtodonciaDentalink([r("Prótesis", "Contenido de kit")]), false);
  assert.equal(prestacionEsOrtodoncia("Cuentas de bracketeria"), false);
});

test("sin renglones o renglones vacíos: false", () => {
  assert.equal(esOrtodonciaDentalink([]), false);
  assert.equal(esOrtodonciaDentalink([{}]), false);
  assert.equal(esOrtodonciaDentalink(undefined as any), false);
});

test("acepta renglones ya mapeados por el motor", () => {
  assert.equal(renglonEsOrtodoncia({ procedure: "Alineadores", categoria: "" }), true);
  assert.equal(renglonEsOrtodoncia({ procedure: "Limpieza", categoria: "Ortodoncia" }), true);
  assert.equal(renglonEsOrtodoncia({ procedure: "Limpieza", especialidad: "Periodoncia" }), false);
});

test("la columna «Prestación» (categoría de acción) no se confunde con el nombre de la prestación", () => {
  assert.equal(renglonEsOrtodoncia({ "Prestación": "Acción Clínica", "Nombre Prestación": "Resina", "Nombre Categoría": "Operatoria" }), false);
});
