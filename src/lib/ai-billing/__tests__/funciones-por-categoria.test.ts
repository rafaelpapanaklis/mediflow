/**
 * WS1-T4 ronda 6 · G3 — «Funciones de IA» solo enseña lo que es del giro de la clínica.
 *
 * Run: npx tsx --test src/lib/ai-billing/__tests__/funciones-por-categoria.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUNCIONES_IA,
  esFuncionIa,
  funcionesIaParaCategoria,
  sanitizeAiSettings,
} from "../interruptores";

const ids = (categoria: string | null | undefined) => funcionesIaParaCategoria(categoria).map((f) => f.id);
const TODAS = FUNCIONES_IA.map((f) => f.id);

test("una clínica DENTAL no ve «Homeopatía» y sí todo lo demás, en el orden del catálogo", () => {
  assert.equal(ids("DENTAL").includes("homeopathy"), false);
  assert.deepEqual(ids("DENTAL"), TODAS.filter((id) => id !== "homeopathy"));
});

test("las demás categorías ven lo mismo que antes (catálogo entero)", () => {
  for (const categoria of [
    "MEDICINE", "NUTRITION", "PSYCHOLOGY", "DERMATOLOGY", "AESTHETIC_MEDICINE", "HAIR_RESTORATION",
    "BEAUTY_CENTER", "BROW_LASH", "MASSAGE", "LASER_HAIR_REMOVAL", "HAIR_SALON", "ALTERNATIVE_MEDICINE",
    "NAIL_SALON", "SPA", "PHYSIOTHERAPY", "PODIATRY", "OTHER",
  ]) {
    assert.deepEqual(ids(categoria), TODAS, categoria);
  }
});

test("sin categoría conocida se enseña todo (no se esconde nada por accidente)", () => {
  assert.deepEqual(ids(null), TODAS);
  assert.deepEqual(ids(undefined), TODAS);
  assert.deepEqual(ids(""), TODAS);
});

test("«Homeopatía» SIGUE en el catálogo: su id vale y lo apagado se conserva", () => {
  assert.equal(TODAS.includes("homeopathy"), true);
  assert.equal(esFuncionIa("homeopathy"), true);
  assert.deepEqual(sanitizeAiSettings({ apagadas: ["homeopathy"] }), { apagadas: ["homeopathy"] });
});

test("no muta el catálogo", () => {
  const antes = FUNCIONES_IA.length;
  funcionesIaParaCategoria("DENTAL");
  assert.equal(FUNCIONES_IA.length, antes);
});
