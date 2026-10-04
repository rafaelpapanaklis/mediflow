/**
 * Auditoría de uso, grupo G1 (dinero núcleo), 4-oct-2026 — ws1-t5.
 *
 * Run: npm run test:dinero-auditoria-uso
 *
 * Cada prueba es un caso con los números del reporte de la auditoría y falla
 * con el código de antes (se dice cómo en cada una).
 */
import "@/lib/sabina/tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { deriveWindow, type CajaDb } from "@/lib/caja";
import { ingresosDelPeriodo, ingresosPorDoctorDelPeriodo } from "@/lib/dinero/ingresos.server";
import { crearBase, type Fila } from "@/lib/sabina/tools/__tests__/doble-base";
import { CL_NORTE, CL_SUR, U_DOC_N, U_DOC2_N } from "@/lib/sabina/tools/__tests__/siembra";

// Octubre de 2026 en la Ciudad de México (UTC−6).
const OCT = { gte: new Date("2026-10-01T06:00:00.000Z"), lt: new Date("2026-11-01T06:00:00.000Z") };
const dia = (d: number, h = 18) => new Date(Date.UTC(2026, 9, d, h));

// ── C-01 ───────────────────────────────────────────────────────────────────
// MF-1124 (Dr. B): «Pedir anticipo» $4,000 → anticipo de $500 por transferencia
// el 3-oct → la cita se cancela con «Dejarlo como saldo a favor» el 4-oct
// (traspaso de $500 y la factura CANCELADA) → MF-1126 corona $4,000: se le
// aplica el saldo ($500 «anticipo») y paga $3,500 por transferencia el 5-oct.
// Además MF-9 (Dr. A): cobro $1,000 el 3-oct, reembolso REAL de $1,000 el 6-oct
// y la factura cancelada; y MF-0: cancelada sin ningún «refund» (dato viejo).
function siembraC01() {
  const factura = (over: Fila): Fila => ({ paid: 0, discount: 0, dueDate: null, items: [], appointmentId: null, doctorId: null, createdAt: dia(1), ...over });
  const pago = (id: string, invoiceId: string, amount: number, method: string, paidAt: Date, refundMethod: string | null = null): Fila =>
    ({ id, invoiceId, amount, method, paidAt, refundMethod });
  return crearBase({
    clinics: [{ id: CL_NORTE, timezone: "America/Mexico_City", category: "DENTAL" }, { id: CL_SUR, timezone: "America/Cancun", category: "DENTAL" }],
    users: [
      { id: U_DOC_N, clinicId: CL_NORTE, role: "DOCTOR", firstName: "Doc", lastName: "A", isActive: true },
      { id: U_DOC2_N, clinicId: CL_NORTE, role: "DOCTOR", firstName: "Doc", lastName: "B", isActive: true },
    ],
    patients: [{ id: "p1", clinicId: CL_NORTE, firstName: "Lucía", lastName: "Méndez", status: "ACTIVE", visibleUserIds: [] }],
    invoices: [
      factura({ id: "mf1124", clinicId: CL_NORTE, patientId: "p1", doctorId: U_DOC2_N, status: "CANCELLED", total: 4_000, paid: 0, balance: 4_000 }),
      factura({ id: "mf1126", clinicId: CL_NORTE, patientId: "p1", doctorId: U_DOC2_N, status: "PAID", total: 4_000, paid: 4_000, balance: 0 }),
      factura({ id: "mf9", clinicId: CL_NORTE, patientId: "p1", doctorId: U_DOC_N, status: "CANCELLED", total: 1_000, paid: 0, balance: 1_000 }),
      factura({ id: "mf0", clinicId: CL_NORTE, patientId: "p1", doctorId: U_DOC_N, status: "CANCELLED", total: 700, paid: 700, balance: 700 }),
      factura({ id: "s1", clinicId: CL_SUR, patientId: "ps", status: "CANCELLED", total: 9_999, paid: 0, balance: 9_999 }),
    ],
    payments: [
      pago("a1", "mf1124", 500, "transfer", dia(3)),
      pago("a2", "mf1124", 500, "refund", dia(4), "saldo_a_favor"),
      pago("c1", "mf1126", 500, "anticipo", dia(5)),
      pago("c2", "mf1126", 3_500, "transfer", dia(5)),
      pago("r1", "mf9", 1_000, "cash", dia(3)),
      pago("r2", "mf9", 1_000, "refund", dia(6), "cash"),
      pago("v1", "mf0", 700, "cash", dia(3)),
      pago("s1a", "s1", 9_999, "cash", dia(3)),
      pago("s1b", "s1", 9_999, "refund", dia(4), "saldo_a_favor"),
    ],
    patientCredits: [
      { id: "pc1", clinicId: CL_NORTE, patientId: "p1", amount: 500, source: "cita_cancelada", creditDate: dia(4) },
      { id: "pc2", clinicId: CL_NORTE, patientId: "p1", amount: -500, source: "aplicado_a_factura", creditDate: dia(5) },
    ],
  });
}

const diaMx = (d: Date) => new Date(d.getTime() - 6 * 3_600_000).toISOString().slice(0, 10);

test("C-01 · el anticipo de $500 de una cita cancelada «a favor» es ingreso el día que entró (antes: en ningún lado)", async () => {
  const db = siembraC01();
  const r = await ingresosDelPeriodo(CL_NORTE, OCT, diaMx, db);
  // 500 (anticipo, 3-oct) + 3,500 (corona) + 1,000 (cobro de MF-9) − 1,000 (su reembolso real, 6-oct).
  // Con el código viejo: 3,500 (la cancelada se llevaba el cobro y el reembolso de MF-9 también).
  assert.equal(r.neto, 4_000);
  assert.equal(r.porClave["2026-10-03"], 1_500, "el 3-oct: anticipo $500 + cobro $1,000; la cancelada sin «refund» (dato viejo) sigue fuera");
  assert.equal(r.porClave["2026-10-04"] ?? 0, 0, "el traspaso a saldo a favor no resta nada");
  assert.equal(r.porClave["2026-10-05"], 3_500, "aplicar el saldo no suma otra vez");
  assert.equal(r.porClave["2026-10-06"], -1_000, "el reembolso real resta el día que salió el dinero");
});

test("C-01 · no es retroactivo: el 3-oct vale lo mismo antes y después de cancelar la cita", async () => {
  const antes = crearBase({
    clinics: [{ id: CL_NORTE, timezone: "America/Mexico_City", category: "DENTAL" }],
    invoices: [{ id: "mf1124", clinicId: CL_NORTE, patientId: "p1", doctorId: U_DOC2_N, status: "PARTIAL", total: 4_000, paid: 500, balance: 3_500, discount: 0, items: [], appointmentId: null, createdAt: dia(1) }],
    payments: [{ id: "a1", invoiceId: "mf1124", amount: 500, method: "transfer", paidAt: dia(3), refundMethod: null }],
  });
  const dia3 = { gte: new Date("2026-10-03T06:00:00.000Z"), lt: new Date("2026-10-04T06:00:00.000Z") };
  const r0 = await ingresosDelPeriodo(CL_NORTE, dia3, undefined, antes);
  const r1 = await ingresosDelPeriodo(CL_NORTE, dia3, undefined, siembraC01());
  assert.equal(r0.neto, 500);
  assert.equal(r1.neto - 1_000, 500, "después de cancelar, el anticipo del 3-oct sigue ahí (más el cobro de MF-9 del mismo día)");
});

test("C-01 · «Por doctor»: el Dr. B suma los $4,000 que le cobró a la paciente (antes $3,500) y la suma es el ingreso", async () => {
  const db = siembraC01();
  const m = await ingresosPorDoctorDelPeriodo(CL_NORTE, OCT, db);
  assert.equal(m.get(U_DOC2_N)?.total, 4_000);
  assert.equal(m.get(U_DOC_N)?.total ?? 0, 0, "MF-9: cobrado y devuelto");
  let suma = 0;
  for (const v of m.values()) suma += v.total;
  assert.equal(suma, 4_000);
});

test("C-01 · Caja: el turno del 3-oct lista el anticipo por transferencia y lo suma a «otros»", async () => {
  const db = siembraC01() as unknown as CajaDb;
  const w = await deriveWindow(CL_NORTE, new Date("2026-10-03T06:00:00.000Z"), new Date("2026-10-04T05:59:59.000Z"), { db });
  assert.ok(w.list.some((f) => f.paymentId === "a1"), "antes la fila de las 12:00 no estaba");
  assert.equal(w.otherIncome, 500);
  assert.equal(w.cashIncome, 1_000);
  const w4 = await deriveWindow(CL_NORTE, new Date("2026-10-04T06:00:00.000Z"), new Date("2026-10-05T05:59:59.000Z"), { db });
  assert.equal(w4.refunds, 0, "el traspaso no es reembolso");
  assert.equal(w4.toCredit, 500, "se ve aparte: pasó a saldo a favor");
  const w6 = await deriveWindow(CL_NORTE, new Date("2026-10-06T06:00:00.000Z"), new Date("2026-10-07T05:59:59.000Z"), { db });
  assert.equal(w6.cashRefunds, 1_000, "el reembolso en efectivo de una factura cancelada sí sale del cajón");
});
