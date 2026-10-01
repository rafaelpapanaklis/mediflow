/**
 * El dictado AGREGA al final, nunca reemplaza (ws1-t9).
 *   npx tsx --tsconfig tsconfig.test.json --test src/components/clinical/shared/__tests__/dictado-agrega.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendDictado } from "../dictation-mic";

test("campo vacío: queda el texto dictado", () => {
  assert.equal(appendDictado("", "hola"), "hola");
  assert.equal(appendDictado(null, "hola"), "hola");
  assert.equal(appendDictado("   \n", "hola"), "hola");
});

test("con texto previo: lo conserva y agrega al final con el separador", () => {
  assert.equal(appendDictado("Dolor al frío.  \n", "Mejora."), "Dolor al frío.\nMejora.");
  assert.equal(appendDictado("Dolor", "mejora", " "), "Dolor mejora");
});

test("respeta el tope del campo sin tocar lo ya escrito", () => {
  const r = appendDictado("a".repeat(10), "b".repeat(50), "\n", 20);
  assert.equal(r.length, 20);
  assert.ok(r.startsWith("a".repeat(10)));
});
