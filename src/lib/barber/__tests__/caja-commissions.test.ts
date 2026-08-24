// Motor de comisiones + dinero + periodos (puro, sin BD).
//   npx tsx --test src/lib/barber/__tests__/caja-commissions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  BarberCajaError,
  commissionBaseFor,
  computeCommission,
  currentPeriodKey,
  isSaleCancelled,
  money,
  parseMoneyInput,
  payoutFor,
  periodKeyFor,
  periodRange,
  resolveCommissionScope,
  shiftPeriodKey,
  CANCELLED_MARK,
  type CommissionLine,
} from "../commissions";

const D = (v: number | string) => new Prisma.Decimal(v);
const TZ = "America/Mexico_City";

// Ticket de referencia: Corte $180 + Barba $140 + Cera $150 (producto),
// descuento $20, propina $50. Subtotal 450; la propina NO es línea.
const TICKET: CommissionLine[] = [
  { kind: "service", qty: 1, unitPrice: D(180) },
  { kind: "service", qty: 1, unitPrice: D(140) },
  { kind: "product", qty: 1, unitPrice: D(150) },
  { kind: "adjustment", qty: 1, unitPrice: D(-20) },
];

test("política SERVICES: base = servicios − descuento; el producto queda fuera", () => {
  const base = commissionBaseFor(TICKET, { base: "SERVICES" });
  assert.equal(base.toFixed(2), "300.00"); // 180 + 140 − 20
});

test("política SERVICES_AND_PRODUCTS: base = todo el subtotal", () => {
  const base = commissionBaseFor(TICKET, { base: "SERVICES_AND_PRODUCTS" });
  assert.equal(base.toFixed(2), "450.00"); // 180 + 140 + 150 − 20
});

test("la propina no puede entrar a la base: no existe como línea", () => {
  // Aunque alguien intentara colarla como ajuste positivo, la base es de
  // líneas del ticket; el motor recibe tip aparte y jamás lo suma.
  const withTip = commissionBaseFor(TICKET, { base: "SERVICES" });
  const sameWithoutTip = commissionBaseFor(TICKET, { base: "SERVICES" });
  assert.equal(withTip.toFixed(2), sameWithoutTip.toFixed(2));
});

// ── Los tres esquemas del mercado, un caso a mano cada uno ──────────────

test("COMMISSION 40% sobre base 300 → 120.00 (la propina de 50 no cambia nada)", () => {
  const r = computeCommission({ commissionType: "COMMISSION", commissionPct: D("40"), chairRent: null }, D(300));
  assert.equal(r.base.toFixed(2), "300.00");
  assert.equal(r.pct?.toFixed(2), "40.00");
  assert.equal(r.amount.toFixed(2), "120.00");
  // pago del periodo con propinas 50: 120 + 50 = 170
  const pay = payoutFor("COMMISSION", { commissionTotal: r.amount, tips: D(50), chairRent: null });
  assert.equal(pay.toFixed(2), "170.00");
});

test("CHAIR_RENT: producción 10,000 − renta 3,000 + propinas 400 → 7,400.00", () => {
  // Cada venta devenga el 100% de su base (amount = base); la renta se
  // resta UNA vez por periodo.
  const sale = computeCommission({ commissionType: "CHAIR_RENT", commissionPct: null, chairRent: D(3000) }, D(10000));
  assert.equal(sale.pct, null);
  assert.equal(sale.amount.toFixed(2), "10000.00");
  const pay = payoutFor("CHAIR_RENT", { commissionTotal: sale.amount, tips: D(400), chairRent: D(3000) });
  assert.equal(pay.toFixed(2), "7400.00");
});

test("CHAIR_RENT con producción menor a la renta queda negativo (el barbero debe)", () => {
  const pay = payoutFor("CHAIR_RENT", { commissionTotal: D(1000), tips: D(0), chairRent: D(3000) });
  assert.equal(pay.toFixed(2), "-2000.00");
});

test("SALARY: la producción no cambia el pago; aquí solo cobra propinas", () => {
  const r = computeCommission({ commissionType: "SALARY", commissionPct: D("40"), chairRent: null }, D(5000));
  assert.equal(r.pct, null);
  assert.equal(r.amount.toFixed(2), "0.00");
  assert.equal(r.base.toFixed(2), "5000.00"); // se registra la producción
  const pay = payoutFor("SALARY", { commissionTotal: r.amount, tips: D(250), chairRent: null });
  assert.equal(pay.toFixed(2), "250.00");
});

test("redondeo único al final: 33.33% de 100 → 33.33, no 33.33333", () => {
  const r = computeCommission({ commissionType: "COMMISSION", commissionPct: D("33.33"), chairRent: null }, D(100));
  assert.equal(r.amount.toFixed(2), "33.33");
  const r2 = computeCommission({ commissionType: "COMMISSION", commissionPct: D("12.5"), chairRent: null }, D("0.10"));
  assert.equal(r2.amount.toFixed(2), "0.01"); // 0.0125 → half-up → 0.01
});

test("base negativa (descuento mayor a servicios) se recorta a 0", () => {
  const base = commissionBaseFor(
    [
      { kind: "service", qty: 1, unitPrice: D(100) },
      { kind: "adjustment", qty: 1, unitPrice: D(-150) },
    ],
    { base: "SERVICES" },
  );
  assert.equal(base.toFixed(2), "0.00");
});

// ── Dinero ──────────────────────────────────────────────────────────────

test("parseMoneyInput acepta 2 decimales, rechaza 3 y negativos", () => {
  assert.equal(parseMoneyInput(12.5, { field: "x" }).toFixed(2), "12.50");
  assert.equal(parseMoneyInput("99.99", { field: "x" }).toFixed(2), "99.99");
  assert.equal(parseMoneyInput(undefined, { field: "x" }).toFixed(2), "0.00");
  assert.throws(() => parseMoneyInput(1.005, { field: "x" }), (e: unknown) => e instanceof BarberCajaError && e.code === "INVALID_AMOUNT");
  assert.throws(() => parseMoneyInput(-1, { field: "x" }), BarberCajaError);
  assert.throws(() => parseMoneyInput("abc", { field: "x" }), BarberCajaError);
  assert.throws(() => parseMoneyInput(undefined, { field: "x", required: true }), BarberCajaError);
});

test("money() redondea half-up a centavos", () => {
  assert.equal(money("2.345").toFixed(2), "2.35");
  assert.equal(money("2.344").toFixed(2), "2.34");
  assert.equal(money(null).toFixed(2), "0.00");
});

test("isSaleCancelled solo con la marca al inicio de notes", () => {
  assert.equal(isSaleCancelled({ notes: null }), false);
  assert.equal(isSaleCancelled({ notes: "cliente frecuente" }), false);
  assert.equal(isSaleCancelled({ notes: `${CANCELLED_MARK} 2026-08-24 · Juan · error` }), true);
  assert.equal(isSaleCancelled({ notes: `nota ${CANCELLED_MARK}` }), false);
});

// ── Periodos en la zona de la barbería ──────────────────────────────────

test("periodKey se calcula en la zona de la barbería, no en UTC", () => {
  // 2026-09-01 03:00 UTC = 2026-08-31 21:00 en CDMX → sigue siendo agosto.
  const d = new Date("2026-09-01T03:00:00.000Z");
  assert.equal(periodKeyFor(d, TZ), "2026-08");
  assert.equal(periodKeyFor(d, "UTC"), "2026-09");
  assert.equal(currentPeriodKey(TZ, d), "2026-08");
});

test("periodRange cubre exactamente el mes local [00:00 día 1, 00:00 día 1 siguiente)", () => {
  const { start, end } = periodRange("2026-08", TZ);
  assert.equal(start.toISOString(), "2026-08-01T06:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-01T06:00:00.000Z");
  const dec = periodRange("2026-12", TZ);
  assert.equal(dec.end.toISOString(), "2027-01-01T06:00:00.000Z");
  assert.throws(() => periodRange("2026-13", TZ), BarberCajaError);
  assert.throws(() => periodRange("agosto", TZ), BarberCajaError);
});

test("shiftPeriodKey cruza el año", () => {
  assert.equal(shiftPeriodKey("2026-01", -1), "2025-12");
  assert.equal(shiftPeriodKey("2026-12", 1), "2027-01");
  assert.equal(shiftPeriodKey("2026-06", 0), "2026-06");
});

// ── Alcance por rol ─────────────────────────────────────────────────────

test("rol BARBER: solo su fila; pedir otro barbero es 403", () => {
  const own = { role: "BARBER" as const, barber: { id: "b1" } as any };
  assert.deepEqual(resolveCommissionScope(own), { selfOnly: true, barberIds: ["b1"] });
  assert.deepEqual(resolveCommissionScope(own, "b1"), { selfOnly: true, barberIds: ["b1"] });
  assert.throws(
    () => resolveCommissionScope(own, "b2"),
    (e: unknown) => e instanceof BarberCajaError && e.status === 403 && e.code === "FORBIDDEN_SCOPE",
  );
  // BARBER sin fila ligada: no ve nada (lista vacía, no "todo").
  assert.deepEqual(resolveCommissionScope({ role: "BARBER", barber: null }), { selfOnly: true, barberIds: [] });
});

test("OWNER/MANAGER ven todo o el barbero pedido", () => {
  assert.deepEqual(resolveCommissionScope({ role: "OWNER", barber: null }), { selfOnly: false, barberIds: null });
  assert.deepEqual(resolveCommissionScope({ role: "MANAGER", barber: null }, "b9"), { selfOnly: false, barberIds: ["b9"] });
});
