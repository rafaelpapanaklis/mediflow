// ═══════════════════════════════════════════════════════════════════════
// Caja completa (ws6-t1, 16-nov-2026): la función ÚNICA del resumen y del
// efectivo esperado (src/lib/barber/caja-resumen.ts). Pura: sin base.
//
//   npx tsx --test src/lib/barber/__tests__/caja-resumen.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  cajaResumen,
  discountFromItems,
  esperadoEnEfectivo,
  type ResumenMovement,
  type ResumenTicket,
} from "@/lib/barber/caja-resumen";
import { breakdownOf, expectedCashFor } from "@/lib/barber/cash";
import { depositLineDescription, depositRefundLineDescription } from "@/lib/barber/memberships-core";

function tk(p: Partial<ResumenTicket> & Pick<ResumenTicket, "paymentMethod" | "total">): ResumenTicket {
  const tip = p.tip ?? 0;
  return {
    subtotal: p.subtotal ?? Number(p.total) - Number(tip),
    tip,
    cancelled: false,
    kind: "sale",
    barberId: null,
    ...p,
  };
}
function mv(p: Partial<ResumenMovement> & Pick<ResumenMovement, "type" | "amount">): ResumenMovement {
  return { method: "CASH", category: null, barberId: null, payoutKind: null, ...p };
}

test("sin movimientos da EXACTAMENTE lo de antes: fondo + Σ tickets en efectivo (también con decimales)", () => {
  const tickets = [
    tk({ paymentMethod: "CASH", total: 179.99, tip: 10 }),
    tk({ paymentMethod: "CASH", total: 180.01 }),
    tk({ paymentMethod: "CARD", total: 300 }),
    tk({ paymentMethod: "CASH", total: 999, cancelled: true }),
  ];
  const r = cajaResumen({ openingAmount: 500, tickets, movements: [] });
  const antes = expectedCashFor(new Prisma.Decimal(500), breakdownOf(tickets as never).cashTotal);
  assert.equal(r.expectedCash, antes.toNumber());
  assert.equal(r.expectedCash, 860);
  assert.equal(r.esperado.cashCharged, 360);
  assert.equal(r.esperado.cashTickets, 2);
  assert.equal(r.esperado.cashTipsIncluded, 10);
});

test("la fórmula: fondo + efectivo + entradas − gastos − retiros − pagos − devoluciones (solo efectivo mueve el cajón)", () => {
  assert.equal(
    esperadoEnEfectivo({ opening: 500, cashCharged: 850, cashIn: 200, cashExpenses: 80, withdrawals: 1000, cashPayouts: 200, cashRefunds: 0 }).toNumber(),
    270,
  );
  const r = cajaResumen({
    openingAmount: 500,
    tickets: [tk({ paymentMethod: "CASH", total: 1000 })],
    movements: [
      mv({ type: "EXPENSE", amount: 80, category: "SUPPLIES" }),
      mv({ type: "EXPENSE", amount: 4500, category: "RENT", method: "TRANSFER" }),
      mv({ type: "EXPENSE", amount: 600, category: "UTILITIES", method: "CARD" }),
      mv({ type: "WITHDRAWAL", amount: 300 }),
      mv({ type: "DEPOSIT", amount: 150 }),
      mv({ type: "BARBER_PAYOUT", amount: 100, payoutKind: "ADVANCE", barberId: "b1", barberName: "Juan" }),
      mv({ type: "BARBER_PAYOUT", amount: 2000, payoutKind: "COMMISSION", barberId: "b1", method: "TRANSFER" }),
    ],
  });
  // 500 + 1000 + 150 − 80 − 300 − 100 = 1,170 (renta, luz y la comisión por transferencia no tocan el cajón)
  assert.equal(r.expectedCash, 1170);
  assert.deepEqual(
    { ...r.esperado },
    { opening: 500, cashCharged: 1000, cashTickets: 1, cashTipsIncluded: 0, cashIn: 150, cashExpenses: 80, withdrawals: 300, cashPayouts: 100, cashRefunds: 0, expected: 1170 },
  );
  assert.equal(r.expenses.total, 5180, "los gastos cuentan TODOS en la pestaña Gastos…");
  assert.equal(r.expenses.cash, 80, "…pero al cajón solo el efectivo");
  assert.deepEqual(r.expenses.byCategory.map((c) => [c.category, c.total]), [["RENT", 4500], ["UTILITIES", 600], ["SUPPLIES", 80]]);
  assert.deepEqual(r.expenses.byMethod, { CASH: 80, CARD: 600, TRANSFER: 4500, OTHER: 0 });
  assert.deepEqual(r.payouts.byKind, { ADVANCE: 100, COMMISSION: 2000, SALARY: 0, OTHER: 0 });
  assert.equal(r.payouts.cash, 100);
  assert.equal(r.byBarber.find((b) => b.barberId === "b1")?.paidOut, 2100);
});

test("los movimientos ANULADOS no cuentan (ni por fecha ni por bandera) y se cuentan aparte", () => {
  const r = cajaResumen({
    openingAmount: 100,
    tickets: [],
    movements: [
      mv({ type: "EXPENSE", amount: 80, voidedAt: "2026-11-16T15:00:00Z" }),
      mv({ type: "WITHDRAWAL", amount: 50, voided: true }),
      mv({ type: "DEPOSIT", amount: 20 }),
    ],
  });
  assert.equal(r.expectedCash, 120);
  assert.equal(r.voidedMovements, 2);
  assert.equal(r.expenses.count, 0);
  assert.equal(r.withdrawals.total, 0);
});

test("anticipos: el cobrado entra como ingreso; el devuelto en efectivo se resta APARTE y el total no cambia", () => {
  const tickets = [
    tk({ paymentMethod: "CASH", total: 300, kind: "deposit" }),
    tk({ paymentMethod: "CASH", total: -100, kind: "refund" }),
    tk({ paymentMethod: "SPEI", total: -50, kind: "refund" }),
    tk({ paymentMethod: "CASH", total: 200 }),
  ];
  const r = cajaResumen({ openingAmount: 0, tickets, movements: [] });
  assert.equal(r.esperado.cashCharged, 500, "el efectivo cobrado no lleva las devoluciones dentro…");
  assert.equal(r.esperado.cashRefunds, 100, "…van en su propia fila");
  assert.equal(r.expectedCash, 400);
  assert.equal(r.expectedCash, expectedCashFor(new Prisma.Decimal(0), breakdownOf(tickets as never).cashTotal).toNumber(), "misma cifra que la cuenta de antes");
  assert.deepEqual(r.refunds, { count: 2, total: 150 });
  assert.equal(r.income.total, 350);
  assert.deepEqual(r.income.byKind.refund, { count: 2, total: -150 });
  assert.deepEqual(r.income.byMethod.SPEI, { count: 1, total: -50 });
  assert.equal(r.tickets.count, 1, "una devolución o un anticipo no son una visita");
});

test("ingresos por método (STRIPE = en línea), por tipo, propinas por barbero, descuentos y ticket promedio", () => {
  const items = [
    { description: "Corte", qty: 1, unitPrice: 200 },
    { description: "Descuento", qty: 1, unitPrice: -20 },
    { description: depositLineDescription("16 nov"), qty: 1, unitPrice: -50 },
  ];
  const r = cajaResumen({
    openingAmount: 0,
    tickets: [
      tk({ paymentMethod: "CASH", total: 150, tip: 20, subtotal: 130, barberId: "b1", barberName: "Juan", items }),
      tk({ paymentMethod: "CARD", total: 250, tip: 50, subtotal: 200, barberId: "b2", barberName: "Pepe", discount: 15 }),
      tk({ paymentMethod: "STRIPE", total: 400, subtotal: 400 }),
      tk({ paymentMethod: "SPEI", total: 600, kind: "membership" }),
      tk({ paymentMethod: "CARD", total: 700, cancelled: true, barberId: "b2" }),
    ],
    movements: [],
  });
  assert.deepEqual(r.income.byMethod, {
    CASH: { count: 1, total: 150 },
    CARD: { count: 1, total: 250 },
    SPEI: { count: 1, total: 600 },
    ONLINE: { count: 1, total: 400 },
  });
  assert.equal(r.income.total, 1400);
  assert.deepEqual(r.income.byKind.membership, { count: 1, total: 600 });
  assert.equal(r.income.sales, 730, "ventas sin propinas: 130 + 200 + 400");
  assert.equal(r.tickets.count, 3);
  assert.equal(r.tickets.cancelled, 1);
  assert.equal(r.tickets.average, 243.33, "730 / 3, redondeado una sola vez");
  assert.deepEqual(r.tips, {
    total: 70,
    cash: 20,
    byBarber: [
      { barberId: "b2", barberName: "Pepe", total: 50 },
      { barberId: "b1", barberName: "Juan", total: 20 },
    ],
  });
  assert.equal(r.discounts, 35, "20 de las líneas (el anticipo NO es descuento) + 15 declarado");
  assert.deepEqual(
    r.byBarber.map((b) => [b.barberId, b.tickets, b.produced, b.tips]),
    [["b2", 1, 200, 50], ["b1", 1, 130, 20]],
    "el ticket cancelado de Pepe no cuenta",
  );
});

test("discountFromItems: ni el anticipo ni la devolución son descuento", () => {
  assert.equal(
    discountFromItems([
      { description: "Corte", qty: 1, unitPrice: 200 },
      { description: "Descuento", qty: 1, unitPrice: -18 },
      { description: "Bono 10%", qty: 2, unitPrice: -1.005 },
      { description: depositLineDescription("x"), qty: 1, unitPrice: -100 },
      { description: depositRefundLineDescription("x"), qty: 1, unitPrice: -100 },
    ]).toNumber(),
    20.01,
  );
});

test("el esperado puede salir NEGATIVO (sacaron más de lo que había): no se esconde, se enseña", () => {
  const r = cajaResumen({ openingAmount: 100, tickets: [], movements: [mv({ type: "WITHDRAWAL", amount: 250 })] });
  assert.equal(r.expectedCash, -150);
});

test("montos como texto y Decimal dan lo mismo que como número, sin error de punto flotante", () => {
  const a = cajaResumen({
    openingAmount: "0.10",
    tickets: [tk({ paymentMethod: "CASH", total: "0.20", subtotal: "0.20" })],
    movements: [mv({ type: "DEPOSIT", amount: new Prisma.Decimal("0.30") })],
  });
  assert.equal(a.expectedCash, 0.6);
});

test("EL DÍA DE PRUEBA del dueño (reporte ws6-t1): abrir con $500, 3 tickets, garrafón, adelanto, banco y cambio", () => {
  const r = cajaResumen({
    openingAmount: 500,
    tickets: [
      tk({ paymentMethod: "CASH", total: 850, tip: 50, subtotal: 800, barberId: "b1", barberName: "Juan" }),
      tk({ paymentMethod: "CARD", total: 300, tip: 30, subtotal: 270, barberId: "b2", barberName: "Pepe" }),
      tk({ paymentMethod: "SPEI", total: 180, subtotal: 180, barberId: "b1", barberName: "Juan" }),
    ],
    movements: [
      mv({ type: "EXPENSE", amount: 80, category: "SUPPLIES", note: "Garrafón" } as never),
      mv({ type: "BARBER_PAYOUT", amount: 200, payoutKind: "ADVANCE", barberId: "b2", barberName: "Pepe" }),
      mv({ type: "WITHDRAWAL", amount: 1000 }),
      mv({ type: "DEPOSIT", amount: 200 }),
    ],
  });
  // 500 + 850 + 200 − 80 − 1,000 − 200 = 270
  assert.equal(r.expectedCash, 270);
  assert.equal(r.income.total, 1330);
  assert.deepEqual(
    [r.income.byMethod.CASH.total, r.income.byMethod.CARD.total, r.income.byMethod.SPEI.total],
    [850, 300, 180],
  );
  assert.equal(r.tips.total, 80);
  assert.equal(r.tickets.count, 3);
  assert.equal(r.tickets.average, 416.67);
  assert.equal(r.expenses.total, 80);
  assert.equal(r.payouts.total, 200);
  assert.deepEqual([r.withdrawals.total, r.deposits.total], [1000, 200]);
});
