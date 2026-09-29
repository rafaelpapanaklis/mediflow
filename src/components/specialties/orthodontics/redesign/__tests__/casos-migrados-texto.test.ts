/**
 * Textos de la vista «sin caso» de la pestaña Ortodoncia: un paciente con solo casos MIGRADOS no «no tiene caso»,
 * no tiene caso ACTIVO (y sí historia del sistema anterior).
 * Run: npx tsx --test src/components/specialties/orthodontics/redesign/__tests__/casos-migrados-texto.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { casosAnterioresMigrados, etiquetaAbrirCaso, pistaSinCaso, tituloSinCaso } from "../casos-migrados-texto";

test("sin casos migrados sigue diciendo lo de siempre", () => {
  assert.equal(tituloSinCaso("Ana Prueba", 0), "Ana Prueba no tiene caso de ortodoncia");
  assert.equal(etiquetaAbrirCaso(0), "Abrir caso de ortodoncia");
  assert.match(pistaSinCaso(0, false), /Al abrirlo se registran el diagnóstico y el plan/);
});

test("con casos migrados: «Sin caso activo · tiene N caso(s) anterior(es) migrado(s)» y botón de caso nuevo", () => {
  assert.equal(tituloSinCaso("Ana Prueba", 1), "Sin caso activo · tiene 1 caso anterior migrado");
  assert.equal(tituloSinCaso("Ana Prueba", 3), "Sin caso activo · tiene 3 casos anteriores migrados");
  assert.doesNotMatch(tituloSinCaso("Ana Prueba", 2), /no tiene caso de ortodoncia/);
  assert.equal(etiquetaAbrirCaso(2), "Abrir caso nuevo");
  assert.match(pistaSinCaso(2, false), /historia del sistema anterior está debajo/);
});

test("singular y plural", () => {
  assert.equal(casosAnterioresMigrados(1), "1 caso anterior migrado");
  assert.equal(casosAnterioresMigrados(2), "2 casos anteriores migrados");
});

test("si se llegó desde «Nueva consulta», ese aviso manda sobre los demás", () => {
  assert.match(pistaSinCaso(0, true), /hoja de control de su caso/);
  assert.match(pistaSinCaso(4, true), /hoja de control de su caso/);
});
