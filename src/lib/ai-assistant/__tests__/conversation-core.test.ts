/**
 * Reglas puras del historial del Asistente IA.
 *
 * No hay `npm run test:<x>` para esto (package.json no entra en el alcance de
 * la tarea). Se corre a mano desde la raíz del repo:
 *
 *   npx tsx --test src/lib/ai-assistant/__tests__/conversation-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AI_MESSAGE_MAX_CHARS,
  AI_TITLE_DERIVED_MAX,
  AI_TITLE_MAX,
  chunk,
  clampLimit,
  isGroup,
  isRole,
  normalizeContent,
  normalizeGroup,
  normalizeTitle,
  sanitizeSearchTerm,
  titleFromMessage,
} from "../conversation-core";

test("normalizeTitle recorta, colapsa espacios y devuelve null si queda vacío", () => {
  assert.equal(normalizeTitle("  Dolor   pulpar  "), "Dolor pulpar");
  assert.equal(normalizeTitle("   "), null);
  assert.equal(normalizeTitle(""), null);
  assert.equal(normalizeTitle(null), null);
  assert.equal(normalizeTitle(42), null);
  assert.equal(normalizeTitle("x".repeat(500)).length, AI_TITLE_MAX);
});

test("titleFromMessage corta a 60 como hacía la UI, y nunca devuelve vacío", () => {
  const largo = "a".repeat(200);
  assert.equal(titleFromMessage(largo).length, AI_TITLE_DERIVED_MAX);
  // Un mensaje de puros espacios no puede dejar la conversación sin nombre.
  assert.equal(titleFromMessage("   "), "Conversación");
});

test("normalizeGroup acepta los tres grupos y manda lo desconocido a clinico", () => {
  assert.equal(normalizeGroup("admin"), "admin");
  assert.equal(normalizeGroup("pacientes"), "pacientes");
  assert.equal(normalizeGroup("clinico"), "clinico");
  // Un grupo inventado NO rompe la barra lateral: cae en la sección por defecto.
  assert.equal(normalizeGroup("finanzas"), "clinico");
  assert.equal(normalizeGroup(undefined), "clinico");
  assert.equal(isGroup("admin"), true);
  assert.equal(isGroup("finanzas"), false);
});

test("normalizeContent conserva los saltos de línea del SOAP y recorta al máximo", () => {
  const soap = "S: dolor\nO: caries\nA: pulpitis\nP: endodoncia";
  assert.equal(normalizeContent(`  ${soap}  `), soap);
  assert.equal(normalizeContent("   "), null);
  assert.equal(normalizeContent(undefined), null);
  assert.equal(normalizeContent("z".repeat(AI_MESSAGE_MAX_CHARS + 500)).length, AI_MESSAGE_MAX_CHARS);
  assert.equal(isRole("assistant"), true);
  assert.equal(isRole("system"), false);
});

test("sanitizeSearchTerm quita los comodines vivos de LIKE", () => {
  // `contains` de Prisma pasa el texto tal cual al ILIKE de Postgres: sin esto,
  // buscar "%" listaría todo el historial y "_" traería resultados que nadie pidió.
  assert.equal(sanitizeSearchTerm("%"), null);
  assert.equal(sanitizeSearchTerm("%%"), null);
  assert.equal(sanitizeSearchTerm("cari%es"), "cari es");
  assert.equal(sanitizeSearchTerm("a_b\\c"), "a b c");
  assert.equal(sanitizeSearchTerm("  endo  "), "endo");
  assert.equal(sanitizeSearchTerm(""), null);
  assert.equal(sanitizeSearchTerm(null), null);
});

test("clampLimit rechaza basura y respeta el techo", () => {
  assert.equal(clampLimit("50", 200, 200), 50);
  assert.equal(clampLimit("9999", 200, 200), 200);
  assert.equal(clampLimit("0", 200, 200), 200);
  assert.equal(clampLimit("-3", 200, 200), 200);
  assert.equal(clampLimit("abc", 200, 200), 200);
  assert.equal(clampLimit(null, 200, 200), 200);
});

test("chunk reparte sin perder elementos (el pooler no aguanta >7 en paralelo)", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 5), []);
  assert.deepEqual(chunk([1, 2, 3], 10), [[1, 2, 3]]);
  const cien = Array.from({ length: 100 }, (_, i) => i);
  const tandas = chunk(cien, 5);
  assert.equal(tandas.length, 20);
  assert.equal(tandas.flat().length, 100);
  assert.throws(() => chunk([1], 0));
});
