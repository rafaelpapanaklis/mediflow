/**
 * WS1-T4 ronda 6 · G1/G2 — la categoría de una clínica dental queda fija.
 *
 * Run: npx tsx --test src/lib/clinic/__tests__/categoria-fija.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORIA_FIJA,
  categoriaAlGuardar,
  categoriaDeSucursal,
  esCategoriaFija,
} from "../categoria-fija";

test("guardar: una clínica DENTAL que pide SPA se queda DENTAL", () => {
  assert.equal(categoriaAlGuardar("DENTAL", "SPA"), "DENTAL");
});

test("guardar: una clínica DENTAL que pide DENTAL se queda DENTAL", () => {
  assert.equal(categoriaAlGuardar("DENTAL", "DENTAL"), "DENTAL");
});

test("guardar: una clínica de NUTRITION que pide SPA pasa a SPA (nada cambia para ellas)", () => {
  assert.equal(categoriaAlGuardar("NUTRITION", "SPA"), "SPA");
});

test("guardar: una clínica de otra categoría SÍ puede pasarse a DENTAL", () => {
  assert.equal(categoriaAlGuardar("OTHER", "DENTAL"), "DENTAL");
});

test("guardar: sin category en el payload no se toca la categoría", () => {
  assert.equal(categoriaAlGuardar("DENTAL", undefined), undefined);
  assert.equal(categoriaAlGuardar("NUTRITION", undefined), undefined);
  assert.equal(categoriaAlGuardar(null, undefined), undefined);
});

test("guardar: en una clínica DENTAL un valor raro no rompe, se conserva DENTAL", () => {
  assert.equal(categoriaAlGuardar("DENTAL", null), "DENTAL");
  assert.equal(categoriaAlGuardar("DENTAL", ""), "DENTAL");
  assert.equal(categoriaAlGuardar("DENTAL", 42), "DENTAL");
  assert.equal(categoriaAlGuardar("DENTAL", { $set: "SPA" }), "DENTAL");
});

test("guardar: sin categoría actual conocida se respeta lo pedido", () => {
  assert.equal(categoriaAlGuardar(null, "SPA"), "SPA");
  assert.equal(categoriaAlGuardar(undefined, "MEDICINE"), "MEDICINE");
});

test("sucursal: la madre DENTAL fuerza DENTAL aunque el cliente mande otra", () => {
  assert.equal(categoriaDeSucursal("DENTAL", "SPA"), "DENTAL");
  assert.equal(categoriaDeSucursal("DENTAL", "DENTAL"), "DENTAL");
});

test("sucursal: una madre de otra categoría deja elegir", () => {
  assert.equal(categoriaDeSucursal("SPA", "NAIL_SALON"), "NAIL_SALON");
  assert.equal(categoriaDeSucursal("NUTRITION", "DENTAL"), "DENTAL");
  assert.equal(categoriaDeSucursal(null, "MASSAGE"), "MASSAGE");
});

test("esCategoriaFija: solo DENTAL exacto", () => {
  assert.equal(CATEGORIA_FIJA, "DENTAL");
  assert.equal(esCategoriaFija("DENTAL"), true);
  assert.equal(esCategoriaFija("dental"), false);
  assert.equal(esCategoriaFija("MEDICINE"), false);
  assert.equal(esCategoriaFija(null), false);
  assert.equal(esCategoriaFija(undefined), false);
});
