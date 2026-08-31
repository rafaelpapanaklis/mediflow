/**
 * Dónde cae "Iniciar consulta" según la clínica.
 *
 * Run: npm run test:consult-landing
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSULT_FORM_TAB, consultLandingTab } from "../consult-landing";

test("clínica dental (y el resto de las clínicas) → Nueva consulta", () => {
  for (const category of [
    "DENTAL",
    "MEDICINE",
    "NUTRITION",
    "PSYCHOLOGY",
    "DERMATOLOGY",
    "AESTHETIC_MEDICINE",
    "HAIR_RESTORATION",
    "ALTERNATIVE_MEDICINE",
    "PHYSIOTHERAPY",
    "PODIATRY",
    "OTHER",
  ]) {
    assert.equal(consultLandingTab(category), CONSULT_FORM_TAB, category);
  }
});

test("negocios NO clínicos conservan el editor SOAP de siempre", () => {
  // La visita es un servicio, no una exploración: mandarlos al formulario
  // dental sería el "cambio a lo bruto" que rompe otro vertical.
  for (const category of [
    "SPA",
    "MASSAGE",
    "BEAUTY_CENTER",
    "NAIL_SALON",
    "HAIR_SALON",
    "BROW_LASH",
    "LASER_HAIR_REMOVAL",
  ]) {
    assert.equal(consultLandingTab(category), null, category);
  }
});

test("categoría ausente o desconocida → se asume clínica (DaleControl es dental)", () => {
  assert.equal(consultLandingTab(null), CONSULT_FORM_TAB);
  assert.equal(consultLandingTab(undefined), CONSULT_FORM_TAB);
  assert.equal(consultLandingTab(""), CONSULT_FORM_TAB);
  assert.equal(consultLandingTab("CATEGORIA_NUEVA"), CONSULT_FORM_TAB);
});

test("la pestaña destino es la que la ficha llama «Nueva consulta»", () => {
  // `expediente` es el id histórico del tab del formulario por especialidad
  // (DentalForm/NutritionForm/…). Renombrarlo aquí sin renombrarlo en
  // patient-nav-items lo dejaría apuntando a una pestaña inexistente.
  assert.equal(CONSULT_FORM_TAB, "expediente");
});
