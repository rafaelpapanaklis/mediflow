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
import { adelantosPorBarbero, costoBarberos, dineroDe, pagosPartidos } from "@/lib/barber/caja-dinero";
import { chairRentForRange, dayKeyOf, hiredInside, rangeSince, salaryForPeriodKey } from "@/lib/barber/sueldo-core";
import { fmtHireDay } from "@/components/barber/commissions/hire-day";

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

// ── Decisión 3: renta y sueldo cuentan desde el ALTA del barbero ────────
// El caso de la sucursal QA-E: «QA-E Renta» ($500 al mes) se dio de alta el 16-nov-2026.
// Comisiones le cobraba $500 de noviembre y $500 de octubre; la Ganancia restaba
// renta de días en que no existía («Periodo anterior: $258.06» en una sede creada hoy).

test("D3: el día de alta es el día LOCAL de la barbería", () => {
  assert.equal(dayKeyOf(new Date("2026-11-17T03:00:00Z"), "America/Mexico_City"), "2026-11-16");
  assert.equal(dayKeyOf(new Date("2026-11-17T07:00:00Z"), "America/Mexico_City"), "2026-11-17");
});

test("D3: el rango nunca empieza antes del alta; sin dato no se recorta", () => {
  assert.deepEqual(rangeSince("2026-11-01", "2026-12-01", "2026-11-16"), { from: "2026-11-16", to: "2026-12-01" });
  assert.deepEqual(rangeSince("2026-11-01", "2026-12-01", "2026-10-03"), { from: "2026-11-01", to: "2026-12-01" });
  assert.deepEqual(rangeSince("2026-11-01", "2026-12-01", "2026-11-01"), { from: "2026-11-01", to: "2026-12-01" });
  assert.deepEqual(rangeSince("2026-11-01", "2026-12-01", null), { from: "2026-11-01", to: "2026-12-01" });
  assert.equal(hiredInside("2026-11", "2026-11-16"), "2026-11-16");
  assert.equal(hiredInside("2026-11", "2026-11-01"), null, "alta el día 1: mes completo");
  assert.equal(hiredInside("2026-12", "2026-11-16"), null);
  assert.equal(hiredInside("2026-10", "2026-11-16"), null);
});

test("D3 (caso QA-E Renta): alta el 16-nov → noviembre $250 (15 de 30 días), octubre $0, diciembre $500", () => {
  const nov = chairRentForRange(500, "2026-11-01", "2026-12-01", "2026-11-16");
  assert.deepEqual([nov.amount.toNumber(), nov.approx], [250, true]);
  const oct = chairRentForRange(500, "2026-10-01", "2026-11-01", "2026-11-16");
  assert.deepEqual([oct.amount.toNumber(), oct.approx], [0, false]);
  const dic = chairRentForRange(500, "2026-12-01", "2027-01-01", "2026-11-16");
  assert.deepEqual([dic.amount.toNumber(), dic.approx], [500, false]);
  // Alta de siempre o sin dato: la renta completa, exacta.
  assert.equal(chairRentForRange(500, "2026-11-01", "2026-12-01", "2020-01-01").amount.toNumber(), 500);
  assert.equal(chairRentForRange(500, "2026-11-01", "2026-12-01").amount.toNumber(), 500);
  assert.equal(chairRentForRange(null, "2026-11-01", "2026-12-01", "2026-11-16").amount.toNumber(), 0);
});

test("D3: el sueldo del periodo también cuenta desde el alta (mensual, quincenal y semanal)", () => {
  const mensual = salaryForPeriodKey({ amount: 6000, period: "MONTHLY" }, "2026-11", "2026-11-16");
  assert.deepEqual([mensual.amount.toNumber(), mensual.approx], [3000, true]);
  // Alta el 16 = empieza la segunda quincena completa: exacto.
  const quincenal = salaryForPeriodKey({ amount: 3000, period: "BIWEEKLY" }, "2026-11", "2026-11-16");
  assert.deepEqual([quincenal.amount.toNumber(), quincenal.approx], [3000, false]);
  const semanal = salaryForPeriodKey({ amount: 1400, period: "WEEKLY" }, "2026-11", "2026-11-17");
  assert.deepEqual([semanal.amount.toNumber(), semanal.approx], [2800, false], "14 días = 2 semanas");
  assert.equal(salaryForPeriodKey({ amount: 6000, period: "MONTHLY" }, "2026-10", "2026-11-16").amount.toNumber(), 0, "antes del alta, nada");
  assert.equal(salaryForPeriodKey({ amount: 6000, period: "MONTHLY" }, "2026-12", "2026-11-16").amount.toNumber(), 6000);
  // Sin alta (llamador viejo), como siempre.
  assert.equal(salaryForPeriodKey({ amount: 6000, period: "MONTHLY" }, "2026-11").amount.toNumber(), 6000);
});

test("D3: la Ganancia no resta renta ni sueldo de días anteriores al alta (adiós «Periodo anterior: $258.06»)", () => {
  const barbers = [
    { id: "renta", commissionType: "CHAIR_RENT", isActive: true, chairRent: 500, salary: null, since: "2026-11-16" },
    { id: "fijo", commissionType: "SALARY", isActive: true, chairRent: null, salary: { amount: 6000, period: "MONTHLY" as const }, since: "2026-11-16" },
  ];
  const entries = new Map<string, number>();
  // Hoy (16-nov): un día de cada uno.
  const hoy = costoBarberos({ entries, barbers, fromDay: "2026-11-16", toDay: "2026-11-17" });
  assert.deepEqual([hoy.chairRent, hoy.salary, hoy.total], [16.67, 200, 183.33]);
  // El mes hasta hoy (1–16 nov): solo cuenta el 16, no los 16 días.
  const mes = costoBarberos({ entries, barbers, fromDay: "2026-11-01", toDay: "2026-11-17" });
  assert.deepEqual([mes.chairRent, mes.salary], [16.67, 200]);
  // Los 16 días anteriores (16–31 oct): no existían.
  const antes = costoBarberos({ entries, barbers, fromDay: "2026-10-16", toDay: "2026-11-01" });
  assert.deepEqual([antes.chairRent, antes.salary, antes.total, antes.approx], [0, 0, 0, false]);
  // Un barbero de siempre no cambia: 16 de 30 días.
  const viejo = costoBarberos({ entries, barbers: [{ ...barbers[0], since: "2020-01-01" }], fromDay: "2026-11-01", toDay: "2026-11-17" });
  assert.equal(viejo.chairRent, 266.67);
  // Sin el dato de alta (llamador viejo), tampoco.
  const sinDato = costoBarberos({ entries, barbers: [{ id: "x", commissionType: "CHAIR_RENT", isActive: true, chairRent: 500, salary: null }], fromDay: "2026-11-01", toDay: "2026-11-17" });
  assert.equal(sinDato.chairRent, 266.67);
});

test("D3: textos — «desde su alta (16 nov)» en es y en", () => {
  assert.equal(fmtHireDay("2026-11-16", "es"), "16 nov");
  assert.equal(fmtHireDay("2026-11-16", "en"), "Nov 16");
  const es = getBarberT("es");
  const en = getBarberT("en");
  assert.equal(es("barber.caja.comisiones.sinceHire", { date: "16 nov" }), "desde su alta (16 nov)");
  assert.equal(en("barber.caja.comisiones.sinceHire", { date: "Nov 16" }), "since they joined (Nov 16)");
  assert.match(es("barber.caja.comisiones.sinceHireHint", { date: "16 nov" }), /Se dio de alta el 16 nov/);
  assert.match(en("barber.caja.comisiones.sinceHireHint", { date: "Nov 16" }), /joined on Nov 16/);
});
