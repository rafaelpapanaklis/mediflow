/**
 * WS1-T4 ronda 6 · G6 — la agenda clásica no ofrece «Nutrición» ni «Psicología»
 * en una clínica dental.
 *
 * Run: npx tsx --test src/lib/agenda/__tests__/tipos-cita-clasica.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIPOS_CITA_CLASICA, tiposDeCitaParaCategoria } from "../tipos-cita-clasica";

test("DENTAL: no se ofrecen «Nutrición» ni «Psicología»; lo demás, en su orden", () => {
  const tipos = tiposDeCitaParaCategoria("DENTAL");
  assert.equal(tipos.includes("Nutrición"), false);
  assert.equal(tipos.includes("Psicología"), false);
  assert.deepEqual(tipos, [
    "Consulta general", "Primera vez", "Revisión / Control", "Limpieza dental", "Extracción",
    "Endodoncia", "Ortodoncia", "Implante", "Cirugía", "Seguimiento", "Otro",
  ]);
});

test("otras categorías (y sin categoría): la lista de siempre, completa", () => {
  for (const c of ["NUTRITION", "PSYCHOLOGY", "MEDICINE", "SPA", "OTHER", null, undefined, ""]) {
    assert.deepEqual(tiposDeCitaParaCategoria(c), [...TIPOS_CITA_CLASICA], String(c));
  }
  assert.equal(TIPOS_CITA_CLASICA.includes("Nutrición"), true, "no se borró del catálogo");
  assert.equal(TIPOS_CITA_CLASICA.includes("Psicología"), true, "no se borró del catálogo");
  assert.equal(TIPOS_CITA_CLASICA.length, 13);
});

test("al editar, el tipo que ya tiene la cita se conserva aunque no se ofrezca", () => {
  const tipos = tiposDeCitaParaCategoria("DENTAL", "Nutrición");
  assert.equal(tipos[tipos.length - 1], "Nutrición");
  assert.equal(tipos.includes("Psicología"), false);
  // Un tipo que no es de la lista (lo puso el bot o la agenda nueva).
  assert.ok(tiposDeCitaParaCategoria("DENTAL", "Valoración de ortodoncia").includes("Valoración de ortodoncia"));
  assert.ok(tiposDeCitaParaCategoria("MEDICINE", "Valoración").includes("Valoración"));
});

test("el tipo actual no se duplica y el catálogo no se muta", () => {
  assert.equal(tiposDeCitaParaCategoria("DENTAL", "Ortodoncia").filter((t) => t === "Ortodoncia").length, 1);
  assert.equal(tiposDeCitaParaCategoria("DENTAL", "").length, 11);
  assert.equal(tiposDeCitaParaCategoria("DENTAL", null).length, 11);
  tiposDeCitaParaCategoria("SPA", "Algo nuevo");
  assert.equal(TIPOS_CITA_CLASICA.length, 13);
});
