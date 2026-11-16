// Sueldo del barbero (ws6-t6, 16-nov-2026): validación y sueldo de un rango.
//
//   npx tsx --test src/lib/barber/__tests__/sueldo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeSalary,
  parseSalaryInput,
  salaryForPeriodKey,
  salaryForRange,
  type BarberSalary,
} from "@/lib/barber/sueldo-core";

const sem: BarberSalary = { amount: 3000, period: "WEEKLY" };
const quin: BarberSalary = { amount: 4500, period: "BIWEEKLY" };
const men: BarberSalary = { amount: 9000, period: "MONTHLY" };
const s = (r: { amount: { toFixed: (n: number) => string }; approx: boolean }) => [r.amount.toFixed(2), r.approx];

// ── Lo que se teclea ──

test("vacío = sin sueldo (como hoy), aunque haya periodo elegido", () => {
  assert.deepEqual(parseSalaryInput("", "WEEKLY"), { ok: true, salary: null });
  assert.deepEqual(parseSalaryInput(null, undefined), { ok: true, salary: null });
  assert.deepEqual(parseSalaryInput("   ", null), { ok: true, salary: null });
});

test("monto válido con periodo; acepta $ y comas como se escriben", () => {
  assert.deepEqual(parseSalaryInput("$3,000", "WEEKLY"), { ok: true, salary: { amount: 3000, period: "WEEKLY" } });
  assert.deepEqual(parseSalaryInput("4500.50", "BIWEEKLY"), { ok: true, salary: { amount: 4500.5, period: "BIWEEKLY" } });
  assert.deepEqual(parseSalaryInput(9000, "MONTHLY"), { ok: true, salary: { amount: 9000, period: "MONTHLY" } });
});

test("monto 0, letras, 3 decimales, negativo o sin periodo: error claro", () => {
  assert.deepEqual(parseSalaryInput("0", "WEEKLY"), { ok: false, error: "amountZero" });
  assert.deepEqual(parseSalaryInput("0.00", "WEEKLY"), { ok: false, error: "amountZero" });
  assert.deepEqual(parseSalaryInput("abc", "WEEKLY"), { ok: false, error: "amountBad" });
  assert.deepEqual(parseSalaryInput("10.123", "WEEKLY"), { ok: false, error: "amountBad" });
  assert.deepEqual(parseSalaryInput("-5", "WEEKLY"), { ok: false, error: "amountBad" });
  assert.deepEqual(parseSalaryInput("99999999", "WEEKLY"), { ok: false, error: "amountBad" });
  assert.deepEqual(parseSalaryInput("3000", ""), { ok: false, error: "periodMissing" });
  assert.deepEqual(parseSalaryInput("3000", "DAILY"), { ok: false, error: "periodMissing" });
});

test("el sueldo solo cuenta si cobra por Sueldo (Comisión o Renta lo apagan sin borrarlo)", () => {
  assert.deepEqual(activeSalary("SALARY", sem), sem);
  assert.equal(activeSalary("COMMISSION", sem), null);
  assert.equal(activeSalary("CHAIR_RENT", sem), null);
  assert.equal(activeSalary("SALARY", null), null);
});

// ── Los tres periodos en un mes de Comisiones ──

test("mensual: un mes natural = el monto, exacto", () => {
  assert.deepEqual(s(salaryForPeriodKey(men, "2026-11")), ["9000.00", false]);
  assert.deepEqual(s(salaryForPeriodKey(men, "2026-02")), ["9000.00", false]);
});

test("quincenal: un mes natural = 2 quincenas, exacto (también febrero y meses de 31)", () => {
  assert.deepEqual(s(salaryForPeriodKey(quin, "2026-11")), ["9000.00", false]);
  assert.deepEqual(s(salaryForPeriodKey(quin, "2026-02")), ["9000.00", false]);
  assert.deepEqual(s(salaryForPeriodKey(quin, "2026-12")), ["9000.00", false]);
});

test("semanal: noviembre (30 días) = 3000 × 30/7 aprox.; febrero de 28 = 4 semanas exactas", () => {
  assert.deepEqual(s(salaryForPeriodKey(sem, "2026-11")), ["12857.14", true]);
  assert.deepEqual(s(salaryForPeriodKey(sem, "2026-02")), ["12000.00", false]);
  assert.deepEqual(s(salaryForPeriodKey(sem, "2026-12")), ["13285.71", true]); // 31 días
});

test("diciembre → enero cruza el año sin perder días", () => {
  assert.deepEqual(s(salaryForPeriodKey(men, "2026-12")), ["9000.00", false]);
});

// ── Rangos parciales ──

test("semanal: dos semanas exactas y 10 días aprox.", () => {
  assert.deepEqual(s(salaryForRange(sem, "2026-11-02", "2026-11-16")), ["6000.00", false]);
  assert.deepEqual(s(salaryForRange(sem, "2026-11-02", "2026-11-12")), ["4285.71", true]);
});

test("quincenal: la primera quincena entera es exacta; del 10 al 20 se prorratea por los días de cada quincena", () => {
  assert.deepEqual(s(salaryForRange(quin, "2026-11-01", "2026-11-16")), ["4500.00", false]);
  // 10–15 nov = 6 de 15 días; 16–20 nov = 5 de 15 días (nov tiene 30): 4500×6/15 + 4500×5/15 = 1800 + 1500
  assert.deepEqual(s(salaryForRange(quin, "2026-11-10", "2026-11-21")), ["3300.00", true]);
});

test("mensual: medio noviembre = la mitad aprox.; del 16-nov al 15-dic se prorratea con los días de cada mes", () => {
  assert.deepEqual(s(salaryForRange(men, "2026-11-01", "2026-11-16")), ["4500.00", true]);
  // 15/30 de nov + 15/31 de dic
  assert.deepEqual(s(salaryForRange(men, "2026-11-16", "2026-12-16")), ["8854.84", true]);
});

// ── El motor de Comisiones (puro) ──

test("splitPayout SALARY: sueldo pendiente + propinas; ya pagado = congelado; sin sueldo = como antes", async () => {
  const { splitPayout, payoutFor, D } = await import("@/lib/barber/commissions");
  const base = { commissionPending: D(0), commissionPaid: D(0), tipsPending: D(50), tipsPaid: D(20), chairRent: null, anyPaid: true };
  const pendiente = splitPayout("SALARY", { ...base, salary: D(9000), salaryPaid: null });
  assert.equal(pendiente.toPay.toFixed(2), "9050.00");
  assert.equal(pendiente.paid.toFixed(2), "20.00");
  const pagado = splitPayout("SALARY", { ...base, salary: D(10000), salaryPaid: D(9000) });
  assert.equal(pagado.toPay.toFixed(2), "50.00", "el sueldo ya pagado no vuelve a «A pagar» aunque luego lo suban");
  assert.equal(pagado.paid.toFixed(2), "9020.00");
  const sinSueldo = splitPayout("SALARY", base);
  assert.equal(sinSueldo.toPay.toFixed(2), "50.00");
  // Invariante: a pagar + pagado = total del periodo.
  assert.equal(
    pendiente.toPay.plus(pendiente.paid).toFixed(2),
    payoutFor("SALARY", { commissionTotal: D(0), tips: D(70), chairRent: null, salary: D(9000) }).toFixed(2),
  );
  // Comisión y renta no se enteran del sueldo.
  const comision = splitPayout("COMMISSION", { ...base, commissionPending: D(100), salary: D(9000), salaryPaid: null });
  assert.equal(comision.toPay.toFixed(2), "150.00");
});

test("rango vacío o al revés = $0", () => {
  assert.deepEqual(s(salaryForRange(men, "2026-11-10", "2026-11-10")), ["0.00", false]);
  assert.deepEqual(s(salaryForRange(men, "2026-11-10", "2026-11-01")), ["0.00", false]);
});
