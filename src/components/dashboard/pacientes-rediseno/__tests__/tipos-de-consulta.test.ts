/**
 * «Nueva consulta» — el selector «Tipo» (Rafael, 28-sep-2026).
 *
 * Run: npx tsx --test src/components/dashboard/pacientes-rediseno/__tests__/tipos-de-consulta.test.ts
 *
 * El fallo: en una clínica dental el selector ofrecía Nutrición, Psicología y
 * Medicina general, y un botón «Reset».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TIPO_ORTODONCIA,
  formularioDeConsulta,
  permiteRestablecerTipo,
  tiposDeConsulta,
} from "../tipos-de-consulta";

const RAIZ = join(__dirname, "..", "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const sinComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
const texto = (dic: any, clave: string) => clave.split(".").reduce((o, k) => o?.[k], dic);

test("dental con el módulo de Ortodoncia: «Dental general» y «Ortodoncia», nada más", () => {
  const tipos = tiposDeConsulta({ categoria: "DENTAL", moduloOrtodoncia: true });
  assert.deepEqual(tipos.map((t) => t.valor), ["dental", "ortodoncia"]);
  assert.deepEqual(tipos.map((t) => texto(es, t.labelKey)), ["Dental general", "Ortodoncia"]);
  assert.deepEqual(tipos.map((t) => texto(en, t.labelKey)), ["General dentistry", "Orthodontics"]);
});

test("dental SIN el módulo: solo «Dental general»", () => {
  const tipos = tiposDeConsulta({ categoria: "DENTAL", moduloOrtodoncia: false });
  assert.deepEqual(tipos.map((t) => texto(es, t.labelKey)), ["Dental general"]);
});

test("en dental no salen Nutrición, Psicología ni Medicina, ni el botón «Reset»", () => {
  for (const moduloOrtodoncia of [true, false]) {
    const valores = tiposDeConsulta({ categoria: "DENTAL", moduloOrtodoncia }).map((t) => t.valor);
    for (const fuera of ["nutrition", "psychology", "medicine"]) assert.ok(!valores.includes(fuera), fuera);
  }
  assert.equal(permiteRestablecerTipo("DENTAL"), false);
});

test("en dental el formulario es siempre el dental, venga lo que venga", () => {
  for (const raro of ["dental", "nutrition", "psychology", "medicine", "ortodoncia", ""]) {
    assert.equal(formularioDeConsulta(raro, "DENTAL"), "dental", raro);
  }
});

test("las demás verticales siguen como estaban: sus cuatro tipos y su «Reset»", () => {
  for (const categoria of ["MEDICINE", "NUTRITION", "PSYCHOLOGY", "OTHER", null, undefined]) {
    const tipos = tiposDeConsulta({ categoria, moduloOrtodoncia: true });
    assert.deepEqual(tipos.map((t) => t.valor), ["dental", "nutrition", "psychology", "medicine"], String(categoria));
    assert.ok(!tipos.some((t) => t.valor === TIPO_ORTODONCIA), "Ortodoncia es de clínicas dentales");
    assert.equal(permiteRestablecerTipo(categoria), true);
    assert.equal(formularioDeConsulta("nutrition", categoria), "nutrition");
  }
  // Y sus textos y formularios siguen en el código: no se borró nada.
  for (const clave of ["optDental", "optNutrition", "optPsychology", "optMedicine", "reset", "resetTitle"]) {
    assert.equal(typeof es.patients.newConsult[clave], "string", clave);
    assert.equal(typeof en.patients.newConsult[clave], "string", clave);
  }
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  for (const formulario of ["NutritionForm", "PsychologyForm", "GeneralMedicineForm"]) {
    assert.ok(ficha.includes(`<${formulario} `), `${formulario} sigue montándose fuera de dental`);
  }
});

test("los dos selectores (el rediseñado y el de siempre) pintan las opciones de la regla", () => {
  const nueva = sinComentarios(leer("src/components/dashboard/pacientes-rediseno/nueva-consulta.tsx"));
  assert.match(nueva, /\{tipos\.map\(\(tipo\) => \(/);
  assert.doesNotMatch(nueva, /<option value="(nutrition|psychology|medicine)"/, "ninguna opción escrita a mano");

  const ficha = sinComentarios(leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx"));
  assert.doesNotMatch(ficha, /<option value="(nutrition|psychology|medicine)"/);
  // Regla vigente (41a1ec21, lectura sin módulo activo): «Ortodoncia» solo se OFRECE con el módulo Y sin el modo solo
  // lectura — quien solo puede leer su expediente no puede iniciar una consulta de ortodoncia.
  assert.match(ficha, /const tiposConsulta = tiposDeConsulta\(\{ categoria: clinicCategory, moduloOrtodoncia: showOrthodontics && !orthoSoloLectura \}\);/);
  const conLlave = tiposDeConsulta({ categoria: "DENTAL", moduloOrtodoncia: true }).map((t) => t.valor);
  const soloLectura = tiposDeConsulta({ categoria: "DENTAL", moduloOrtodoncia: false }).map((t) => t.valor);
  assert.ok(conLlave.includes(TIPO_ORTODONCIA), "con el módulo y con permisos de escritura se ofrece «Ortodoncia»");
  assert.ok(!soloLectura.includes(TIPO_ORTODONCIA), "en solo lectura NO se ofrece «Ortodoncia»");
  assert.equal((ficha.match(/\{tiposConsulta\.map\(|tipos=\{tiposConsulta\}/g) ?? []).length, 2);
  // «Reset»: solo si la regla lo permite.
  assert.match(ficha, /const puedeRestablecerTipo =\s*permiteRestablecerTipo\(clinicCategory\) &&/);
  assert.equal((ficha.match(/puedeRestablecerTipo/g) ?? []).length, 3, "la regla y sus dos usos");
  // El formulario que se monta sale de la regla, no del tipo detectado.
  assert.doesNotMatch(ficha, /currentSpecialty === "(nutrition|psychology|medicine)"\s+&&/);
});

test("elegir «Ortodoncia» lleva a la hoja de control, no a otro formulario", () => {
  const ficha = sinComentarios(leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx"));
  assert.match(
    ficha,
    /if \(valor === TIPO_ORTODONCIA\) \{\s*setAbrirControlOrto\(true\);\s*setTab\("ortodoncia"\);\s*return;\s*\}/,
  );
  assert.match(ficha, /abrirControlAlEntrar=\{abrirControlOrto\}/);
  assert.match(ficha, /onControlAbierto=\{\(\) => setAbrirControlOrto\(false\)\}/);
});
