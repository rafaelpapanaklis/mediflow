/**
 * ARITMÉTICA DEL DINERO de Caja y Finanzas — hallazgos 12 y 18 (WS1-T6).
 *
 * Run: npm run test:caja-dinero
 *
 * La auditoría encontró CERO pruebas sobre los números con los que la clínica
 * cuadra el cajón y el dueño decide la nómina. Por eso nada de esto saltó antes.
 * Cada test de aquí abajo es el caso concreto de un hallazgo, con los importes
 * del reporte:
 *
 *  · 12   Finanzas nunca restaba los reembolsos → netRevenueSeries.
 *  · 18a  expectedCash nunca resta lo devuelto  → expectedCashOf.
 *  · 18b  el arqueo impreso se contradecía      → buildCloseSummary.
 *  · 18c  la apertura sugería efectivo anulado  → cashOnHandPaymentWhere.
 *  · 18d  "Descuentos" mezclaba dos poblaciones → invoiceDiscountPortion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCloseSummary,
  cashOnHandPaymentWhere,
  deriveWindow,
  expectedCashOf,
  invoiceDiscountPortion,
  money,
  netRevenueSeries,
  paymentDiscountPortion,
} from "../caja";
import { bucketKeyOf } from "../analytics/query";

/** El MISMO bucketing que usa /api/finanzas: día natural de México, no UTC. */
const dayKey = (d: Date) => bucketKeyOf(d, "day");

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 12 — Finanzas nunca resta los reembolsos
// ─────────────────────────────────────────────────────────────────────────
test("12 · un cobro reembolsado por completo deja el periodo en $0, no en $10,000", () => {
  const cobros   = [{ amount: 10_000, paidAt: new Date("2026-01-05T18:00:00Z") }];
  const devueltos = [{ amount: 10_000, paidAt: new Date("2026-01-20T18:00:00Z") }];

  const neto = netRevenueSeries(cobros, devueltos, dayKey);

  // El número con el que se pagan comisiones y se decide la nómina.
  assert.equal(neto.ingresos, 0, "ingresos del mes");
  assert.equal(neto.reembolsos, 10_000, "lo devuelto se reporta aparte");
  // Y la serie diaria cuenta la misma historia que el KPI: sube el 5, baja el 20.
  assert.equal(neto.porBucket["2026-01-05"], 10_000);
  assert.equal(neto.porBucket["2026-01-20"], -10_000);
});

test("12 · la suma de la serie diaria es SIEMPRE el KPI (misma población)", () => {
  const cobros = [
    { amount: 3_000, paidAt: new Date("2026-01-05T18:00:00Z") },
    { amount: 1_250.5, paidAt: new Date("2026-01-05T20:00:00Z") },
    { amount: 900, paidAt: new Date("2026-01-11T16:00:00Z") },
  ];
  const devueltos = [{ amount: 1_200, paidAt: new Date("2026-01-11T19:00:00Z") }];

  const neto = netRevenueSeries(cobros, devueltos, dayKey);
  // Se suma EXACTAMENTE lo que sale en el JSON: money() por punto de la serie
  // (finanzas/route.ts) y las claves de bucket de México, no las de UTC.
  const sumaSerie = Object.values(neto.porBucket).reduce((a, b) => a + money(b), 0);

  assert.equal(neto.ingresos, 3_950.5, "KPI de ingresos");
  assert.equal(money(sumaSerie), neto.ingresos, "la gráfica suma lo que dice la tarjeta");
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 18a — el faltante fantasma del corte
// ─────────────────────────────────────────────────────────────────────────
test("18a · la fórmula ya sabe restar lo devuelto en efectivo (falta el dato, no la fórmula)", () => {
  const turno = { openingBalance: 0, cashIncome: 3_000, withdrawals: 0 };

  // ⚠️ Esto NO demuestra que el faltante fantasma esté cerrado en producción:
  // hoy `cashRefunds` vale 0 SIEMPRE porque el reembolso no guarda con qué
  // método salió el dinero (sql/payment-refund-method.sql). Sin ese dato, el
  // corte sigue reclamando los $3,000 que ya no están en el cajón:
  assert.equal(expectedCashOf(turno), 3_000, "comportamiento de HOY, sin el dato");

  // Lo que sí queda demostrado es que la fórmula —ahora una sola, compartida
  // por la pantalla y el cierre— resta bien en cuanto le llegue el dato.
  assert.equal(expectedCashOf({ ...turno, cashRefunds: 3_000 }), 0);
});

test("18a · la fórmula del esperado es UNA sola: apertura + efectivo − retiros − devuelto", () => {
  assert.equal(
    expectedCashOf({ openingBalance: 1_500, cashIncome: 4_320.75, withdrawals: 800, cashRefunds: 320.75 }),
    4_700,
  );
  // Sin reembolsos identificados el resultado es idéntico al de siempre.
  assert.equal(expectedCashOf({ openingBalance: 1_500, cashIncome: 4_320.75, withdrawals: 800 }), 5_020.75);
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 18b — el arqueo impreso no puede contradecirse a sí mismo
// ─────────────────────────────────────────────────────────────────────────
/** Ventana derivada de un turno, con el mismo contrato que deriveWindow. */
function derivadoFalso(over: Partial<Awaited<ReturnType<typeof deriveWindow>>> = {}) {
  const base: Awaited<ReturnType<typeof deriveWindow>> = {
    cashIncome: 0, cardDebitIncome: 0, cardCreditIncome: 0, otherIncome: 0,
    totalIncome: 0, refunds: 0, cashRefunds: 0, discounts: 0, tax: 0, list: [],
  };
  return { ...base, ...over };
}

test("18b · el resumen del cierre se imprime con el pago que entró entre el render y el clic", () => {
  // La pantalla se pintó en el SSR con $5,000 de efectivo. Entre el render y el
  // clic entra un pago de $700 en efectivo: el servidor lo ve, la pantalla no.
  const pago700 = {
    paymentId: "p700", at: "2026-01-20T21:59:00.000Z", patientName: "Ana Ruiz",
    concept: "Limpieza", amount: 700, method: "cash", discount: 0, doctorName: "—",
  };
  const fresco = derivadoFalso({
    cashIncome: 5_700, totalIncome: 5_700, list: [pago700],
  });

  const s = buildCloseSummary({
    openedAt:       new Date("2026-01-20T15:00:00Z"),
    closedAt:       new Date("2026-01-20T22:00:00Z"),
    openingBalance: 0,
    withdrawals:    0,
    counted:        5_000,
    derived:        fresco,
  });

  // El papel cuadra CONSIGO MISMO: apertura + efectivo − retiros = esperado.
  assert.equal(s.expectedCash, 5_700, "esperado fresco, no el del render");
  assert.equal(s.cashIncome, 5_700, "el efectivo impreso es el mismo del esperado");
  assert.equal(s.openingBalance + s.cashIncome - s.withdrawals, s.expectedCash);
  assert.equal(s.variance, -700, "la diferencia sale del mismo cálculo");
  // Y el pago que la causa SÍ está en la tabla impresa.
  assert.equal(s.list.length, 1);
  assert.equal(s.list[0].paymentId, "p700");
});

test("18b · el resumen desglosa la tarjeta aparte de 'otros', como la pantalla", () => {
  // deriveWindow devuelve otherIncome CON tarjeta; el arqueo la lista aparte.
  const s = buildCloseSummary({
    openedAt: new Date("2026-01-20T15:00:00Z"),
    closedAt: new Date("2026-01-20T22:00:00Z"),
    openingBalance: 100, withdrawals: 50, counted: 1_050,
    derived: derivadoFalso({
      cashIncome: 1_000, cardDebitIncome: 400, cardCreditIncome: 250,
      otherIncome: 800, totalIncome: 1_800, refunds: 90,
    }),
  });

  assert.equal(s.otherIncome, 150, "800 − 400 débito − 250 crédito");
  assert.equal(s.expectedCash, 1_050);
  assert.equal(s.variance, 0);
  assert.equal(s.refunds, 90, "los reembolsos del turno se imprimen");
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 18c — la apertura sugerida no prefija efectivo que no está
// ─────────────────────────────────────────────────────────────────────────
test("18c · el efectivo sugerido para abrir excluye las facturas CANCELADAS", () => {
  const from = new Date("2026-01-20T06:00:00Z");
  const to   = new Date("2026-01-20T18:00:00Z");
  const w: any = cashOnHandPaymentWhere("clinic-1", from, to);

  assert.equal(w.method, "cash", "solo efectivo: lo demás no está en el cajón");
  assert.equal(w.invoice.clinicId, "clinic-1", "aislado por tenant, siempre");
  assert.deepEqual(
    w.invoice.status,
    { notIn: ["CANCELLED"] },
    "una factura anulada no deja billetes en el cajón",
  );
  assert.equal(w.paidAt.gte, from);
  assert.equal(w.paidAt.lte, to);
});

// ─────────────────────────────────────────────────────────────────────────
// HALLAZGO 18d — "Descuentos" y "Ingresos" hablan de lo mismo
// ─────────────────────────────────────────────────────────────────────────
test("18d · el descuento no cobrado NO se imprime junto a los ingresos del turno", () => {
  // La factura del hallazgo: emitida en el turno con $20,000 de descuento. Hasta
  // que no se cobre, no aporta nada al corte — el turno solo habla del dinero
  // que entró. (Una factura sin cobrar no produce ninguna fila de Payment, así
  // que el corte ni siquiera la ve; el prorrateo es lo que impide que vuelva a
  // colarse por la puerta de "facturas creadas en la ventana".)
  const factura = { discount: 20_000, total: 2_000 };
  assert.equal(invoiceDiscountPortion(0, factura), 0);

  // Y cuando entra un abono, entra SU parte y no el descuento entero.
  assert.equal(invoiceDiscountPortion(200, factura), 2_000, "10 % cobrado → 10 % del descuento");
});

test("18d · cobrar, reembolsar y volver a cobrar NO duplica el descuento", () => {
  // Caso real de recepción: se cobra con el método equivocado, se reembolsa y se
  // vuelve a cobrar con el correcto. /refund devuelve el balance a la factura,
  // así que la suma de pagos SUPERA el total y el clamp por pago no lo impide:
  // sin el signo del reembolso, el corte imprimía $1,000 de descuento sobre una
  // factura cuyo descuento es $500.
  const factura = { discount: 500, total: 2_000 };
  const movimientos = [
    { method: "cash",   amount: 2_000 },
    { method: "refund", amount: 2_000 },
    { method: "debit",  amount: 2_000 },
  ];

  const total = movimientos.reduce(
    (sum, m) => sum + paymentDiscountPortion(m.method, m.amount, factura),
    0,
  );
  assert.equal(money(total), 500, "el descuento de la factura, una sola vez");

  // Y un reembolso parcial revierte su parte: cobrado $2,000, devuelto $1,000 →
  // el turno se queda con el descuento de los $1,000 que sí entraron.
  const parcial =
    paymentDiscountPortion("cash", 2_000, factura) +
    paymentDiscountPortion("refund", 1_000, factura);
  assert.equal(money(parcial), 250);
});

test("18d · el descuento viaja con el cobro y se prorratea en los abonos", () => {
  const factura = { discount: 20_000, total: 2_000 };

  // Cobrada completa en el turno: el descuento entero es de este turno.
  assert.equal(invoiceDiscountPortion(2_000, factura), 20_000);

  // Dos abonos: cada turno se lleva su parte y entre los dos suman el descuento.
  const abono1 = invoiceDiscountPortion(500, factura);
  const abono2 = invoiceDiscountPortion(1_500, factura);
  assert.equal(abono1, 5_000);
  assert.equal(abono2, 15_000);
  assert.equal(abono1 + abono2, factura.discount);

  // Sin descuento, sin total o con total 0 no hay nada que prorratear.
  assert.equal(invoiceDiscountPortion(1_000, { discount: 0, total: 2_000 }), 0);
  assert.equal(invoiceDiscountPortion(1_000, { discount: 500, total: 0 }), 0);
  assert.equal(invoiceDiscountPortion(1_000, null), 0);
  // Un sobrepago no reparte más descuento del que la factura tiene.
  assert.equal(invoiceDiscountPortion(9_999, factura), 20_000);
});
