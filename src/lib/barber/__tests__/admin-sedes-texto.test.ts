// «Sedes: 1 (matriz)» en /admin/barberias (ws6-t1, 16-nov, punto 3).
// Rafael: «dice que tiene 0 sucursales… Barba Negra no debería ser 1?».
//
//   npx tsx --test src/lib/barber/__tests__/admin-sedes-texto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { textoSedes, textoSedesTotales } from "@/components/admin/barberias/shared";

const RAIZ = join(__dirname, "..", "..", "..", "..");

test("la matriz cuenta como sede: nunca «0»", () => {
  assert.equal(textoSedes(0), "Sedes: 1 (matriz)");
  assert.equal(textoSedes(1), "Sedes: 2 (matriz + 1 sucursal)");
  assert.equal(textoSedes(2), "Sedes: 3 (matriz + 2 sucursales)");
  assert.equal(textoSedes(2, 1), "Sedes: 3 (matriz + 2 sucursales) · 1 sucursal cerrada aparte");
  assert.equal(textoSedes(0, 2), "Sedes: 1 (matriz) · 2 sucursales cerradas aparte");
  // Datos raros no producen «0» ni negativos.
  assert.equal(textoSedes(-3), "Sedes: 1 (matriz)");
  assert.equal(textoSedes(Number.NaN), "Sedes: 1 (matriz)");
});

test("la métrica de arriba: total de sedes = matrices + sucursales", () => {
  assert.equal(textoSedesTotales(1, 0), "Sedes en total: 1 (1 matriz + 0 sucursales)");
  assert.equal(textoSedesTotales(5, 2), "Sedes en total: 7 (5 matrices + 2 sucursales)");
  assert.equal(textoSedesTotales(1, 1), "Sedes en total: 2 (1 matriz + 1 sucursal)");
});

test("la lista y la ficha usan ese cálculo (y ya no dicen «Sucursales (0)» ni «0 sucursales activas»)", () => {
  const lista = readFileSync(join(RAIZ, "src/app/admin/barberias/barberias-client.tsx"), "utf8");
  const ficha = readFileSync(join(RAIZ, "src/app/admin/barberias/[id]/barbershop-detail-client.tsx"), "utf8");
  assert.match(lista, /textoSedes\(row\.branchCount\)/);
  assert.match(lista, /textoSedesTotales\(metrics\.accounts, metrics\.branches\)/);
  assert.ok(!/sucursales activas"\} aparte/.test(lista));
  assert.ok(!/row\.branchCount > 0 \?/.test(lista), "la nota de sedes sale también sin sucursales");
  assert.match(ficha, /textoSedes\(sucursalesAbiertas/);
  assert.ok(!/Sucursales \(\{formatInt\(branches\.length\)\}\)/.test(ficha));
});
