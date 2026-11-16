// Revisión ws6-t8 (N1): «Sale de la caja en efectivo» viene MARCADA cuando hay
// caja abierta (si se entrega del cajón sin marcarla, el corte dice «Faltan»
// sin pista). Y G1: el diálogo ya no pide descontar a mano los adelantos.
//   npx tsx --test src/components/barber/commissions/__tests__/sale-de-caja.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "..", "comisiones-client.tsx"), "utf8");

test("la casilla arranca marcada si hay caja abierta, también al abrir otro pago", () => {
  assert.match(src, /useState\(Boolean\(cashOut\?\.sessionOpen\)\)/);
  assert.match(src, /setFromCash\(Boolean\(cashOut\?\.sessionOpen\)\); setPayRow\(r\);/);
  assert.match(src, /checked=\{fromCash && cashOut\.sessionOpen\}/, "sin caja abierta nunca sale marcada");
});

test("los adelantos se enseñan como renglón que resta, sin el aviso de «descuéntalos»", () => {
  assert.doesNotMatch(src, /advancesPay/);
  assert.match(src, /comisiones\.payAdvances/);
});
