/**
 * QA de cierre E — decisiones del 16-nov-2026 (las tomó el gerente; Rafael
 * puede cambiarlas). Aquí va lo PURO de cada una; lo que pide base está en
 * qa-e-decisiones-integration.test.ts.
 *
 *   npx tsx --test src/lib/barber/__tests__/qa-e-decisiones.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { cajaResumen } from "@/lib/barber/caja-resumen";
import { adelantosPorBarbero, dineroDe, pagosPartidos } from "@/lib/barber/caja-dinero";

// ── Decisión 4: el texto de «Te queda hoy» ──────────────────────────────

test("D4: «Te queda hoy» dice la cuenta que hace, la misma de la Ganancia de Reportes (es y en)", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  assert.equal(es("barber.inicio.money.profitHint"), "Ingresos − gastos − lo que les toca a los barberos");
  assert.equal(es("barber.inicio.money.profitHint"), es("barber.reportes.money.profitHint"));
  assert.equal(en("barber.inicio.money.profitHint"), en("barber.reportes.money.profitHint"));
  assert.notEqual(en("barber.inicio.money.profitHint"), es("barber.inicio.money.profitHint"));
});

// ── Decisión 1: «Pagado» con su desglose «en caja / fuera de caja» ─────

type Mov = Parameters<typeof pagosPartidos>[0][number] & { payoutKind: "ADVANCE" | "COMMISSION" | "SALARY" | "OTHER" | null; category: null; barberName: string };
const pago = (p: Partial<Mov> & { amount: number }): Mov => ({
  type: "BARBER_PAYOUT",
  method: "CASH",
  sessionId: "turno-1",
  barberId: "comi2",
  barberName: "QA-E Comi2",
  payoutKind: "COMMISSION",
  category: null,
  voidedAt: null,
  ...p,
});

test("D1: en caja = efectivo de un turno; todo lo demás es fuera de caja; los anulados no cuentan", () => {
  const movs: Mov[] = [
    pago({ amount: 52 }), // desde la caja
    pago({ amount: 71.5, method: "OTHER", sessionId: null }), // marcado pagado sin «sale de la caja»
    pago({ amount: 30, method: "TRANSFER" }), // transferencia anotada con la caja abierta: no sale del cajón
    pago({ amount: 40, sessionId: null, payoutKind: "ADVANCE" }), // efectivo SIN caja abierta
    pago({ amount: 999, voidedAt: "2026-11-16T00:00:00Z" }), // anulado
    pago({ amount: 10, barberId: "otro", barberName: "Otro" }),
    { ...pago({ amount: 500 }), type: "EXPENSE" }, // un gasto no es un pago
  ];
  const p = pagosPartidos(movs);
  assert.deepEqual([p.drawer, p.outside], [62, 141.5]);
  assert.deepEqual(p.byBarber.get("comi2"), { drawer: 52, outside: 141.5 });
  assert.deepEqual(p.byBarber.get("otro"), { drawer: 10, outside: 0 });

  // Es la MISMA plata que el resumen de la Caja: nada se cuenta dos veces.
  const resumen = cajaResumen({ openingAmount: 0, tickets: [], movements: movs });
  assert.equal(p.drawer + p.outside, resumen.payouts.total);
  const d = dineroDe(resumen, adelantosPorBarbero(movs), undefined, false, p);
  assert.deepEqual(d.payoutsSplit, { drawer: 62, outside: 141.5 });
  const comi2 = d.byBarber.find((b) => b.barberId === "comi2")!;
  assert.deepEqual([comi2.paidOut, comi2.paidDrawer, comi2.paidOutside, comi2.advances], [193.5, 52, 141.5, 40]);
  assert.equal(comi2.paidDrawer + comi2.paidOutside, comi2.paidOut);
});

test("D1: sin el desglose (un llamador viejo) lo que no fue efectivo se da por fuera de caja y el total no cambia", () => {
  const movs: Mov[] = [pago({ amount: 80 }), pago({ amount: 20, method: "CARD" })];
  const d = dineroDe(cajaResumen({ openingAmount: 0, tickets: [], movements: movs }));
  assert.deepEqual(d.payoutsSplit, { drawer: 80, outside: 20 });
  assert.equal(d.payouts.total, 100);
});

test("D1: textos — la columna vuelve a «Pagado», con «en caja / fuera de caja» (es y en)", () => {
  const es = getBarberT("es");
  const en = getBarberT("en");
  assert.equal(es("barber.reportes.money.colPaidOut"), "Pagado");
  assert.equal(es("barber.reportes.money.paidSplit", { drawer: "$52.00", outside: "$71.50" }), "en caja $52.00 · fuera de caja $71.50");
  assert.equal(en("barber.reportes.money.paidSplit", { drawer: "$52.00", outside: "$71.50" }), "from the register $52.00 · outside the register $71.50");
  for (const k of ["csv.metrics.paidOut", "csv.metrics.paidDrawer", "csv.metrics.paidOutside", "csv.metrics.payoutsDrawer", "csv.metrics.payoutsOutside", "money.paidSplitHint"]) {
    assert.notEqual(es(`barber.reportes.${k}`), `barber.reportes.${k}`, k);
    assert.notEqual(en(`barber.reportes.${k}`), es(`barber.reportes.${k}`), k);
  }
  assert.doesNotMatch(es("barber.reportes.money.paidOutHint"), /no aparece/, "ya no hace falta el aviso: ahora sí cuenta");
  assert.match(es("barber.caja.comisiones.outsideHint"), /fuera de caja/);
  assert.match(en("barber.caja.comisiones.outsideHint"), /outside the register/);
});
