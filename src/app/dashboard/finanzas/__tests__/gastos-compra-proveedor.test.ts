/**
 * B6 de la QA en vivo de ws1-t10 (REPORTE-ws1-t10.md): en Finanzas → Gastos,
 * la fila de un gasto nacido de una compra de inventario no mostraba el
 * proveedor (aunque la API ya lo traía), y «Eliminar gasto» lo borraba sin
 * avisar que las existencias/costo que sumó esa compra se quedan igual —
 * Finanzas e Inventario dejan de cuadrar.
 *
 * Al revisar (ws1-t6): la parte del proveedor ya estaba en pantalla (commit
 * 5610eb52 de ws1-t4, anterior a esta QA); lo que faltaba de verdad era el
 * aviso al borrar. Este test cubre las dos partes: candado de que el
 * proveedor siga mostrándose, y candado nuevo del aviso.
 *
 * Run: npx tsx --test src/app/dashboard/finanzas/__tests__/gastos-compra-proveedor.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEXTO = readFileSync(join(__dirname, "..", "finanzas-client.tsx"), "utf8");
const API = readFileSync(join(__dirname, "..", "..", "..", "api", "gastos", "route.ts"), "utf8");

test("la API de gastos manda providerName de la compra ligada", () => {
  assert.match(API, /providerName:\s*g\.purchase\?\.provider\?\.name\s*\?\?\s*null/);
});

test("la fila de un gasto con purchaseId muestra el proveedor", () => {
  assert.match(TEXTO, /g\.purchaseId\s*&&\s*\(/, "hay una rama que solo pinta cuando el gasto viene de una compra");
  assert.match(TEXTO, /Compra\{g\.providerName \? ` · \$\{g\.providerName\}` : ""\}/, "el proveedor se agrega al rótulo «Compra»");
});

test("borrar un gasto de compra avisa que las existencias no se revierten", () => {
  const fn = /async function deleteGasto\(id: string\) \{([\s\S]*?)\n  \}/.exec(TEXTO)?.[1] ?? "";
  assert.match(fn, /gasto\?\.purchaseId/, "deleteGasto consulta si el gasto tiene purchaseId");
  assert.match(fn, /no revierte las existencias/i, "el aviso explica que no se revierten existencias/costo");
  assert.match(fn, /window\.confirm\(aviso\)/, "el confirm usa el aviso condicional, no un texto fijo");
});
