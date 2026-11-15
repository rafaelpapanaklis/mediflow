// QA B (15-nov-2026) · Ticket impreso: el descuento salía dos veces (como
// concepto «Descuento -$18.00» y otra vez en los totales «Descuento −$18.00»).
//
//   npx tsx --test src/lib/barber/__tests__/ticket-impreso-descuento.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ticketPrintLines } from "@/components/barber/cash/print-lines";
import { depositLineDescription } from "@/lib/barber/memberships-core";

const T1 = [
  { id: "a", description: "Corte de cabello", unitPrice: 180, qty: 1 },
  { id: "b", description: "Descuento", unitPrice: -18, qty: 1 },
];

test("con el resumen del descuento en los totales, la línea negativa no se repite", () => {
  assert.deepEqual(ticketPrintLines(T1, true).map((i) => i.description), ["Corte de cabello"]);
  assert.deepEqual(ticketPrintLines(T1, false).map((i) => i.description), ["Corte de cabello", "Descuento"]);
});

test("el anticipo aplicado NO es descuento: se queda entre los conceptos", () => {
  const dep = depositLineDescription("16-nov");
  const items = [...T1, { id: "c", description: dep, unitPrice: -100, qty: 1 }];
  assert.deepEqual(ticketPrintLines(items, true).map((i) => i.description), ["Corte de cabello", dep]);
});

test("un bono con nombre se queda (dice qué bono fue)", () => {
  const items = [...T1, { id: "d", description: "Bono: 10% en tu próxima visita", unitPrice: -16.2, qty: 1 }];
  assert.deepEqual(ticketPrintLines(items, true).map((i) => i.description), ["Corte de cabello", "Bono: 10% en tu próxima visita"]);
});

test("cash.ts sigue escribiendo «Descuento» en la línea del descuento", () => {
  const cash = readFileSync(join(__dirname, "../cash.ts"), "utf8");
  assert.match(cash, /const DISCOUNT_DESCRIPTION = "Descuento";/);
});

test("el ticket impreso usa el filtro", () => {
  const src = readFileSync(join(__dirname, "../../../components/barber/cash/ticket-print.tsx"), "utf8");
  assert.match(src, /ticketPrintLines\(sale\.items, sale\.discount > 0\)\.map/);
});
