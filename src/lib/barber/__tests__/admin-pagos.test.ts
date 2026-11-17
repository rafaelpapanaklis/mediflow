// Lo que la barbería le paga a DaleControl (ws6-t1): las cuentas puras de
// admin-pagos-core.ts. Sin base.
//   npx tsx --test src/lib/barber/__tests__/admin-pagos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pagosNoDisponibles, resumirPagos, type FilaPago, type FilaTotales } from "../admin-pagos-core";

const d = (s: string) => new Date(s);
const fila = (over: Partial<FilaPago>): FilaPago => ({
  stripe_invoice_id: "in_1",
  status: "paid",
  amount_cents: 74900,
  currency: "mxn",
  plan_id: "AVANZADO",
  billing_interval: "month",
  period_start: d("2026-10-14T00:00:00Z"),
  period_end: d("2026-11-14T00:00:00Z"),
  paid_at: d("2026-10-14T00:05:00Z"),
  failure_code: null,
  created_at: d("2026-10-14T00:05:00Z"),
  ...over,
});
const totales = (over: Partial<FilaTotales> = {}): FilaTotales => ({
  pagados: 2,
  fallidos: 1,
  total_cents: 149800,
  pagado_hasta: d("2026-12-14T00:00:00Z"),
  ultimo_pago_at: d("2026-11-14T00:05:00Z"),
  ultimo_pago_cents: 74900,
  price_cents: 898800,
  sub_interval: "year",
  stripe_status: "active",
  current_period_end: d("2027-11-14T00:00:00Z"),
  cancel_at_period_end: false,
  manual_access_at: null,
  tiene_terminos: true,
  ...over,
});

test("centavos → pesos exactos; anual ÷ 12 en «al mes»; la renovación es la de Stripe", () => {
  const r = resumirPagos({
    pagaId: "m",
    esSucursal: false,
    filas: [fila({ stripe_invoice_id: "in_2", paid_at: d("2026-11-14T00:05:00Z") }), fila({ stripe_invoice_id: "in_1" })],
    totales: totales(),
  });
  assert.equal(r.disponible, true);
  assert.equal(r.totalCobrado, "1498.00");
  assert.equal(r.pagados, 2);
  assert.equal(r.fallidos, 1);
  assert.deepEqual(r.ultimoPago, { fecha: "2026-11-14T00:05:00.000Z", monto: "749.00" });
  assert.equal(r.terminos?.importe, "8988.00");
  assert.equal(r.terminos?.mensual, "749.00");
  assert.equal(r.terminos?.ciclo, "year");
  assert.equal(r.proximaRenovacion, "2027-11-14T00:00:00.000Z");
  assert.equal(r.pagos[0].invoiceId, "in_2");
  assert.equal(r.pagos[0].monto, "749.00");
  assert.equal(r.pagos[0].moneda, "MXN");
  // 2 pagados + 1 rechazado y solo 2 listados.
  assert.equal(r.hayMas, true);
});

test("sin términos de Stripe, la renovación es el «pagado hasta» de los cobros", () => {
  const r = resumirPagos({ pagaId: "m", esSucursal: false, filas: [], totales: totales({ tiene_terminos: false, current_period_end: null, price_cents: null }) });
  assert.equal(r.terminos, null);
  assert.equal(r.proximaRenovacion, "2026-12-14T00:00:00.000Z");
});

test("un rechazo se lista con su motivo y la fecha en que se registró; un pagado no lleva motivo", () => {
  const r = resumirPagos({
    pagaId: "m",
    esSucursal: false,
    filas: [
      fila({ stripe_invoice_id: "in_f", status: "failed", paid_at: null, failure_code: "card_declined", created_at: d("2026-11-15T10:00:00Z") }),
      fila({ stripe_invoice_id: "in_p", failure_code: "viejo" }),
    ],
    totales: totales({ pagados: 1, fallidos: 1 }),
  });
  assert.equal(r.pagos[0].estado, "failed");
  assert.equal(r.pagos[0].motivo, "card_declined");
  assert.equal(r.pagos[0].fecha, "2026-11-15T10:00:00.000Z");
  assert.equal(r.pagos[1].motivo, null);
  assert.equal(r.hayMas, false);
});

test("sin cobros: total $0 medido, sin último pago; sin tablas: «no disponible», no un $0 inventado", () => {
  const vacio = resumirPagos({
    pagaId: "m",
    esSucursal: true,
    filas: [],
    totales: totales({ pagados: 0, fallidos: 0, total_cents: null, pagado_hasta: null, ultimo_pago_at: null, ultimo_pago_cents: null, tiene_terminos: false }),
  });
  assert.equal(vacio.disponible, true);
  assert.equal(vacio.totalCobrado, "0.00");
  assert.equal(vacio.ultimoPago, null);
  assert.equal(vacio.esSucursal, true);
  const sin = pagosNoDisponibles("m", false);
  assert.equal(sin.disponible, false);
  assert.equal(sin.pagos.length, 0);
});

test("la lista se corta en el límite; los conteos siguen siendo de todos", () => {
  const filas = Array.from({ length: 30 }, (_, i) => fila({ stripe_invoice_id: `in_${i}` }));
  const r = resumirPagos({ pagaId: "m", esSucursal: false, filas, totales: totales({ pagados: 30, fallidos: 0 }), limite: 24 });
  assert.equal(r.pagos.length, 24);
  assert.equal(r.pagados, 30);
  assert.equal(r.hayMas, true);
});
