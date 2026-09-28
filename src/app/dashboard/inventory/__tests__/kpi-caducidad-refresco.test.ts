/**
 * B3 de la QA en vivo de ws1-t10 (REPORTE-ws1-t10.md): al registrar una
 * compra con lote y caducidad, la API de alertas ya contaba el lote nuevo,
 * pero la tarjeta «Caducidad» de Inventario se quedaba con el número viejo
 * hasta recargar la página (los avisos solo se pedían una vez, al montar).
 * Además, mientras cargaban mostraba «—», que se confunde con «cero».
 *
 * Candados de fuente (mismo criterio que los demás test de esta ola: sin
 * jsdom, se lee el código).
 *
 * Run: npx tsx --test src/app/dashboard/inventory/__tests__/kpi-caducidad-refresco.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..");
const TEXTO = readFileSync(join(SRC, "app/dashboard/inventory/inventory-client.tsx"), "utf8");

test("aplicarResultadoCompra vuelve a pedir los avisos de caducidad", () => {
  const fn = /function aplicarResultadoCompra\(r: ResultadoCompra\) \{([\s\S]*?)\n  \}/.exec(TEXTO)?.[1] ?? "";
  assert.match(fn, /cargarAvisos\(\)/, "una compra registrada no dispara cargarAvisos()");
});

test("cargarAvisos es la única fuente de /api/inventory/alerts (nada de fetch duplicado)", () => {
  const llamadas = TEXTO.match(/fetch\("\/api\/inventory\/alerts"\)/g) ?? [];
  assert.equal(llamadas.length, 1, "debe haber un solo fetch a /api/inventory/alerts, dentro de cargarAvisos");
  assert.match(TEXTO, /async function cargarAvisos\(\)/, "cargarAvisos existe como función reutilizable");
  assert.match(TEXTO, /useEffect\(\(\) => \{ cargarAvisos\(\); \}, \[\]\);/, "se sigue pidiendo una vez al montar");
});

test("mientras los avisos no llegan, la tarjeta no confunde «cargando» con «cero»", () => {
  const inicio = TEXTO.indexOf("function LineaCaducidad(");
  assert.ok(inicio >= 0, "no se encontró LineaCaducidad");
  const linea = TEXTO.slice(inicio, TEXTO.indexOf("function ItemIcon("));
  assert.match(linea, /if \(!listo\) \{/, "hay una rama propia para «todavía no se sabe»");
  assert.match(linea, /if \(cuantos === 0\) \{/, "hay una rama propia para «se sabe que es cero», separada de la de arriba");
  // La rama de "no listo" ya no debe imprimir el mismo texto que un 0 real.
  const noListo = /if \(!listo\) \{([\s\S]*?)\n  \}/.exec(linea)?.[1] ?? "";
  assert.doesNotMatch(noListo, /<strong>0<\/strong>/, "el estado de carga no debe verse igual que un 0 confirmado");
});
