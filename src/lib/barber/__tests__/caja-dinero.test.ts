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
import { adelantosPorBarbero, cambioPct, costoBarberos, dineroDe, GANANCIA_SIN_PROPINAS } from "@/lib/barber/caja-dinero";

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

test("la ganancia: ingresos SIN propinas − gastos (todos los medios) − lo DEVENGADO por los barberos", () => {
  assert.equal(GANANCIA_SIN_PROPINAS, true, "si Rafael cambia la decisión, esta prueba se ajusta a propósito");
  // Comisión devengada: Juan 50 % de 800 + 300 = 550; Beto 50 % de 800 = 400.
  const costo = costoBarberos({
    entries: new Map([["b1", 550], ["b2", 400]]),
    barbers: [],
    fromDay: "2026-11-16",
    toDay: "2026-11-17",
  });
  const d = dineroDe(cajaResumen({ openingAmount: 0, tickets, movements }), new Map(), costo);
  assert.equal(d.charged, 1950, "850 + 800 + 300 (el cancelado no)");
  assert.equal(d.tips, 50);
  assert.equal(d.income, 1900, "= Σ subtotal: la misma cifra de «Ingresos» de Inicio y Reportes");
  assert.equal(d.expenses.total, 380, "80 efectivo + 300 tarjeta; el anulado de 999 no");
  assert.equal(d.payouts.total, 350, "lo ENTREGADO se enseña…");
  assert.equal(d.barberCost.total, 950);
  // 1,900 − 380 − 950 = 570. Ni los pagos (350) ni el retiro ni la entrada tocan la ganancia.
  assert.equal(d.profit, 570);
});

test("🔴 G2 (caso de t8): $800 + $50 de propina al 50 % → Ganancia $400, se haya marcado pagado o no", () => {
  const corte = [venta({ subtotal: 800, tip: 50, total: 850 })];
  const costo = costoBarberos({ entries: new Map([["b1", 400]]), barbers: [], fromDay: "2026-11-01", toDay: "2026-12-01" });
  const sinPagar = dineroDe(cajaResumen({ openingAmount: 0, tickets: corte, movements: [] }), new Map(), costo);
  // Pagado «desde la caja»: $450 = $400 de comisión + $50 de propina.
  const pagado = [mov({ type: "BARBER_PAYOUT", amount: 450, barberId: "b1", payoutKind: "COMMISSION" })];
  const conPago = dineroDe(cajaResumen({ openingAmount: 0, tickets: corte, movements: pagado }), new Map(), costo);
  // Pagado por transferencia, sin pasar por el cajón.
  const transfer = [mov({ type: "BARBER_PAYOUT", amount: 450, method: "TRANSFER", barberId: "b1", payoutKind: "COMMISSION" })];
  const porTransfer = dineroDe(cajaResumen({ openingAmount: 0, tickets: corte, movements: transfer }), new Map(), costo);
  for (const d of [sinPagar, conPago, porTransfer]) {
    assert.equal(d.income, 800);
    assert.equal(d.tips, 50, "la propina se enseña aparte");
    assert.equal(d.profit, 400);
  }
  assert.equal(conPago.payouts.total, 450, "lo entregado sigue a la vista, pero no resta");
  assert.equal(sinPagar.cashNet - conPago.cashNet, 450, "el cajón sí sabe que salieron $450");
});

test("lo devengado: sueldo del periodo y renta de silla prorrateados; dados de baja sin sueldo ni renta", () => {
  const barbers = [
    { id: "s1", commissionType: "SALARY", isActive: true, chairRent: null, salary: { amount: 3000, period: "MONTHLY" as const } },
    { id: "s2", commissionType: "SALARY", isActive: false, chairRent: null, salary: { amount: 9000, period: "MONTHLY" as const } },
    { id: "r1", commissionType: "CHAIR_RENT", isActive: true, chairRent: 3000, salary: null },
    { id: "c1", commissionType: "COMMISSION", isActive: true, chairRent: null, salary: { amount: 5000, period: "MONTHLY" as const } },
  ];
  // Noviembre completo: sueldo 3,000; renta 3,000; la comisión de la de renta (su producción íntegra) 4,000.
  const mes = costoBarberos({ entries: new Map([["r1", 4000]]), barbers, fromDay: "2026-11-01", toDay: "2026-12-01" });
  assert.deepEqual(mes, { commission: 4000, salary: 3000, chairRent: 3000, total: 4000, approx: false });
  // Un día de noviembre: 1/30 de cada uno, y avisa que es aproximado.
  const dia = costoBarberos({ entries: new Map(), barbers, fromDay: "2026-11-16", toDay: "2026-11-17" });
  assert.deepEqual(dia, { commission: 0, salary: 100, chairRent: 100, total: 0, approx: true });
  // Solo renta: el barbero le debe a la barbería → el costo es negativo (suma a la ganancia).
  const soloRenta = costoBarberos({ entries: new Map(), barbers: [barbers[2]], fromDay: "2026-11-01", toDay: "2026-12-01" });
  assert.equal(soloRenta.total, -3000);
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
