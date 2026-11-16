// ═══════════════════════════════════════════════════════════════════════
// Caja completa en Inicio y Reportes (ws6-t5): la cuenta de la GANANCIA
// encima de cajaResumen (ws6-t1). Puro, sin base.
//
//   npx tsx --test src/lib/barber/__tests__/caja-dinero.test.ts
// ═══════════════════════════════════════════════════════════════════════
import "./_sin-server-only";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cajaResumen, type ResumenMovement, type ResumenTicket } from "@/lib/barber/caja-resumen";
import { adelantosPorBarbero, cambioPct, dineroDe, GANANCIA_SIN_PROPINAS } from "@/lib/barber/caja-dinero";

const venta = (p: Partial<ResumenTicket>): ResumenTicket => ({
  paymentMethod: "CASH",
  subtotal: 0,
  tip: 0,
  total: 0,
  cancelled: false,
  kind: "sale",
  barberId: "b1",
  barberName: "Juan",
  ...p,
});
const mov = (p: Partial<ResumenMovement> & Pick<ResumenMovement, "type" | "amount">): ResumenMovement => ({
  method: "CASH",
  category: null,
  barberId: null,
  payoutKind: null,
  ...p,
});

// El día del dueño: 3 tickets (efectivo con propina, tarjeta, SPEI), uno
// cancelado; gasto de garrafón en efectivo, limpieza con tarjeta, uno
// anulado; adelanto en efectivo y comisión por transferencia; retiro y
// entrada (no son ganancia ni pérdida: solo mueven el cajón).
const tickets: ResumenTicket[] = [
  venta({ subtotal: 800, tip: 50, total: 850, paymentMethod: "CASH" }),
  venta({ subtotal: 800, total: 800, paymentMethod: "CARD", barberId: "b2", barberName: "Beto" }),
  venta({ subtotal: 300, total: 300, paymentMethod: "SPEI" }),
  venta({ subtotal: 9999, total: 9999, cancelled: true }),
];
const movements: ResumenMovement[] = [
  mov({ type: "EXPENSE", amount: 80, category: "SUPPLIES" }),
  mov({ type: "EXPENSE", amount: 300, method: "CARD", category: "CLEANING" }),
  mov({ type: "EXPENSE", amount: 999, category: "OTHER", voidedAt: new Date().toISOString() }),
  mov({ type: "BARBER_PAYOUT", amount: 200, barberId: "b1", barberName: "Juan", payoutKind: "ADVANCE" }),
  mov({ type: "BARBER_PAYOUT", amount: 150, method: "TRANSFER", barberId: "b2", barberName: "Beto", payoutKind: "COMMISSION" }),
  mov({ type: "WITHDRAWAL", amount: 1000 }),
  mov({ type: "DEPOSIT", amount: 200 }),
];

test("la ganancia: ingresos SIN propinas − gastos (todos los medios) − pagos a barberos", () => {
  assert.equal(GANANCIA_SIN_PROPINAS, true, "si Rafael cambia la decisión, esta prueba se ajusta a propósito");
  const d = dineroDe(cajaResumen({ openingAmount: 0, tickets, movements }));
  assert.equal(d.charged, 1950, "850 + 800 + 300 (el cancelado no)");
  assert.equal(d.tips, 50);
  assert.equal(d.income, 1900, "= Σ subtotal: la misma cifra de «Ingresos» de Inicio y Reportes");
  assert.equal(d.expenses.total, 380, "80 efectivo + 300 tarjeta; el anulado de 999 no");
  assert.equal(d.payouts.total, 350);
  // 1,900 − 380 − 350 = 1,170. Retiro y entrada no tocan la ganancia.
  assert.equal(d.profit, 1170);
});

test("🔴 un gasto con tarjeta SÍ cuenta en la ganancia pero NO en el efectivo", () => {
  const sin = dineroDe(cajaResumen({ openingAmount: 0, tickets, movements: [] }));
  const conTarjeta = dineroDe(cajaResumen({ openingAmount: 0, tickets, movements: [mov({ type: "EXPENSE", amount: 300, method: "CARD", category: "CLEANING" })] }));
  assert.equal(sin.profit - conTarjeta.profit, 300, "la ganancia baja 300");
  assert.equal(conTarjeta.cashNet, sin.cashNet, "el cajón no se entera");
  assert.equal(conTarjeta.expenses.cash, 0);
  const conEfectivo = dineroDe(cajaResumen({ openingAmount: 0, tickets, movements: [mov({ type: "EXPENSE", amount: 300, category: "SUPPLIES" })] }));
  assert.equal(sin.cashNet - conEfectivo.cashNet, 300, "en efectivo, el cajón sí baja");
  assert.equal(conEfectivo.profit, conTarjeta.profit, "y la ganancia baja igual");
});

test("🔴 los gastos anulados no cuentan en nada", () => {
  const anulado = [mov({ type: "EXPENSE", amount: 999, category: "RENT", voidedAt: "2026-11-16T10:00:00Z" })];
  const d = dineroDe(cajaResumen({ openingAmount: 0, tickets: [], movements: anulado }));
  assert.equal(d.expenses.total, 0);
  assert.equal(d.expenses.count, 0);
  assert.deepEqual(d.expenses.byCategory, []);
  assert.equal(d.profit, 0);
});

test("el efectivo neto del periodo es el esperado de Caja SIN fondo", () => {
  const r = cajaResumen({ openingAmount: 500, tickets, movements });
  const d = dineroDe(r);
  // efectivo: 850 + 200 − 80 − 1,000 − 200 = −230 (el fondo no cuenta como ingreso)
  assert.equal(d.cashNet, -230);
  assert.equal(r.expectedCash, 270, "la Caja, con fondo de 500, dice 270");
});

test("por barbero: propinas, lo pagado y, aparte, los adelantos (anulados y otros tipos no)", () => {
  const adv = adelantosPorBarbero([
    { type: "BARBER_PAYOUT", payoutKind: "ADVANCE", barberId: "b1", amount: 200, voidedAt: null },
    { type: "BARBER_PAYOUT", payoutKind: "ADVANCE", barberId: "b1", amount: 50.5, voidedAt: null },
    { type: "BARBER_PAYOUT", payoutKind: "ADVANCE", barberId: "b1", amount: 999, voidedAt: "2026-11-16T10:00:00Z" },
    { type: "BARBER_PAYOUT", payoutKind: "COMMISSION", barberId: "b2", amount: 150, voidedAt: null },
    { type: "EXPENSE", payoutKind: null, barberId: null, amount: 80, voidedAt: null },
  ]);
  assert.deepEqual([...adv.entries()], [["b1", 250.5]]);
  const d = dineroDe(cajaResumen({ openingAmount: 0, tickets, movements }), adv);
  const juan = d.byBarber.find((b) => b.barberId === "b1")!;
  const beto = d.byBarber.find((b) => b.barberId === "b2")!;
  assert.deepEqual({ tips: juan.tips, paidOut: juan.paidOut, advances: juan.advances }, { tips: 50, paidOut: 200, advances: 250.5 });
  assert.deepEqual({ tips: beto.tips, paidOut: beto.paidOut, advances: beto.advances }, { tips: 0, paidOut: 150, advances: 0 });
});

test("centavos: sin errores de coma flotante", () => {
  const d = dineroDe(
    cajaResumen({
      openingAmount: 0,
      tickets: [venta({ subtotal: 0.1, total: 0.1 }), venta({ subtotal: 0.2, total: 0.2 })],
      movements: [mov({ type: "EXPENSE", amount: 0.1, method: "CARD" })],
    }),
  );
  assert.equal(d.income, 0.3);
  assert.equal(d.profit, 0.2);
});

test("cambio contra el periodo anterior", () => {
  assert.equal(cambioPct(150, 100), 50);
  assert.equal(cambioPct(50, 100), -50);
  assert.equal(cambioPct(100, 0), null, "sin periodo anterior no hay porcentaje");
  assert.equal(cambioPct(-50, -100), 50, "pérdida menor = mejora");
});
