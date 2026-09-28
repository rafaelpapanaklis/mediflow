/**
 * B5 de la QA en vivo de ws1-t10 (REPORTE-ws1-t10.md): si el GET de lotes
 * fallaba (502, red caída…), el modal decía «Este artículo todavía no tiene
 * lotes» — igual que si de verdad no tuviera ninguno — e invitaba a
 * registrar uno nuevo encima de los que ya existían.
 *
 * Run: npx tsx --test src/components/dashboard/inventory/__tests__/lotes-modal-error-carga.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEXTO = readFileSync(join(__dirname, "..", "lotes-modal.tsx"), "utf8");

test("el catch del GET marca un error propio, no un array vacío", () => {
  const cargar = /const cargar = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[itemId\]\);/.exec(TEXTO)?.[1] ?? "";
  assert.match(cargar, /setError\(false\)/, "cargar() limpia el error al reintentar");
  assert.match(cargar, /catch \{([\s\S]*?)\}/, "hay un catch");
  const catchBlock = /catch \{([\s\S]*?)\}\s*finally/.exec(cargar)?.[1] ?? "";
  assert.match(catchBlock, /setLotes\(null\)/, "en error, lotes queda en null (no en [])");
  assert.match(catchBlock, /setError\(true\)/, "en error, se marca error=true");
});

test("el estado de error pinta su propio mensaje, distinto del vacío legítimo", () => {
  assert.match(TEXTO, /\{cargando \? \(/, "sigue existiendo el estado de carga");
  assert.match(TEXTO, /\) : error \? \(/, "hay una rama `error` entre cargando y el resto");
  assert.match(TEXTO, /No se pudieron cargar los lotes/, "el mensaje de error no dice «todavía no tiene lotes»");
  assert.match(TEXTO, /onClick=\{cargar\}[^>]*>Reintentar/, "el estado de error ofrece reintentar");
});

test("el vacío legítimo (sin lotes de verdad) sigue existiendo tal cual", () => {
  assert.match(TEXTO, /Este artículo todavía no tiene lotes/, "el mensaje de vacío legítimo sigue ahí");
});
