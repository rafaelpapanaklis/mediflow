/**
 * UNA definición de «ingresos» y UNA de «deuda» (ws1-t2, auditoría de dinero
 * del 3-oct-2026: F4 «cuatro ingresos distintos para el mismo mes», F8 «la
 * historia de Dentalink mezclada con el dinero de hoy», F9 «tres deudas»).
 *
 * Run: npm run test:dinero-definiciones
 *
 * La misma siembra se pasa por TODAS las puertas que enseñan dinero y se exige
 * el mismo número:
 *   · septiembre: cobros $10,000 (efectivo $6,000 · transferencia $3,000 ·
 *     tarjeta $1,000 de un caso de ortodoncia), un reembolso real de $1,000,
 *     un pago de una factura CANCELADA ($5,000), una fila vieja de método
 *     "migrated" ($1,400, historia) y la otra clínica con $99,999.
 *   · un anticipo de $500 pagado por Mercado Pago sin factura el 28 (fila de
 *     patient_credits, sin Payment) que se APLICA el 29 (Payment "anticipo"):
 *     cuenta el día que se cobró y aplicarlo no suma otra vez (ws1-t5, LISR
 *     102); un saldo a favor migrado nunca es ingreso.
 *   · ingresos de septiembre = $9,500 en Finanzas, Inicio (tarjeta y gráfica),
 *     Reportes, Sabina y la nómina (por doctor, que además suma lo mismo).
 *   · deuda = $4,000 (sin el borrador de $800 ni la cancelada de $5,000).
 * Con el código viejo fallan: Finanzas contaba la fila "migrated" ($10,400),
 * «Por doctor» era lo facturado, Inicio y Reportes no restaban el reembolso, la
 * nómina contaba `Invoice.paid` por fecha de la cita y Sabina sumaba borradores.
 */
import "@/lib/sabina/tools/__tests__/preparar";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { computeReceivables } from "@/lib/caja";
import { calcularResumenFinanzas } from "@/lib/finanzas-resumen.server";
import {
  deudaInvoiceWhere,
  ingresoNetoDelPeriodo,
  ingresoPaymentWhere,
  ingresosDelPeriodo,
  ingresosPorDoctorDelPeriodo,
  historiaMigradaDelPeriodo,
} from "@/lib/dinero/ingresos.server";
import { historiaDeFactura, netoDelPeriodo, repartirPorDoctor } from "@/lib/dinero/ingresos";
import { ejecutarHerramienta } from "@/lib/sabina/tools";
import { crearBase, type Fila } from "@/lib/sabina/tools/__tests__/doble-base";
import { adminNorte, CL_NORTE, CL_SUR, U_ADMIN_N, U_DOC_N, U_DOC2_N } from "@/lib/sabina/tools/__tests__/siembra";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

// Septiembre de 2026 en la Ciudad de México (UTC−6).
const SEP = { gte: new Date("2026-09-01T06:00:00.000Z"), lt: new Date("2026-10-01T06:00:00.000Z") };
const FIN_SEP = new Date(SEP.lt.getTime() - 1);
const dia = (d: number, h = 18) => new Date(Date.UTC(2026, 8, d, h));

function siembra() {
  const factura = (over: Fila): Fila => ({ paid: 0, discount: 0, dueDate: null, items: [], appointmentId: null, doctorId: null, createdAt: dia(1), ...over });
  const pago = (id: string, invoiceId: string, amount: number, method: string, paidAt: Date): Fila => ({ id, invoiceId, amount, method, paidAt });
  return crearBase({
    clinics: [{ id: CL_NORTE, timezone: "America/Mexico_City", category: "DENTAL" }, { id: CL_SUR, timezone: "America/Cancun", category: "DENTAL" }],
    users: [
      { id: U_ADMIN_N, clinicId: CL_NORTE, role: "ADMIN", firstName: "Ana", lastName: "Admin", isActive: true },
      { id: U_DOC_N, clinicId: CL_NORTE, role: "DOCTOR", firstName: "Hugo", lastName: "Salas", isActive: true },
      { id: U_DOC2_N, clinicId: CL_NORTE, role: "DOCTOR", firstName: "Nadia", lastName: "Rojas", isActive: true },
    ],
    patients: [
      { id: "p1", clinicId: CL_NORTE, firstName: "Uno", lastName: "Ficticio", status: "ACTIVE", visibleUserIds: [] },
      { id: "p2", clinicId: CL_NORTE, firstName: "Dos", lastName: "Ficticio", status: "ACTIVE", visibleUserIds: [] },
      { id: "p3", clinicId: CL_NORTE, firstName: "Tres", lastName: "Ficticio", status: "ACTIVE", visibleUserIds: [] },
    ],
    // La cita de la factura i2 es de Nadia; la factura no trae doctor propio.
    appointments: [{ id: "ap1", clinicId: CL_NORTE, patientId: "p2", doctorId: U_DOC2_N, status: "COMPLETED", startsAt: dia(2), endsAt: dia(2, 19) }],
    invoices: [
      factura({ id: "i1", clinicId: CL_NORTE, patientId: "p1", doctorId: U_DOC_N, status: "PAID", total: 6_000, paid: 6_000, balance: 0 }),
      factura({ id: "i2", clinicId: CL_NORTE, patientId: "p2", appointmentId: "ap1", status: "PARTIAL", total: 4_000, paid: 2_000, balance: 2_000 }),
      // La factura del tratamiento de ortodoncia: sin cita; la lleva Nadia.
      factura({ id: "i3", clinicId: CL_NORTE, patientId: "p3", status: "PARTIAL", total: 3_000, paid: 1_000, balance: 2_000 }),
      // CANCELADA con su pago y su balance (cancelar deja el balance): ni ingreso ni deuda.
      factura({ id: "iC", clinicId: CL_NORTE, patientId: "p1", doctorId: U_DOC_N, status: "CANCELLED", total: 5_000, paid: 5_000, balance: 5_000 }),
      // BORRADOR: todavía no se le cobra a nadie.
      factura({ id: "iD", clinicId: CL_NORTE, patientId: "p3", doctorId: U_DOC_N, status: "DRAFT", total: 800, balance: 800 }),
      // Migrada de Dentalink: `paid` sin Payment, y una fila vieja con método "migrated".
      factura({ id: "iM", clinicId: CL_NORTE, patientId: "p1", status: "PAID", total: 1_400, paid: 1_400, balance: 0 }),
      factura({ id: "s1", clinicId: CL_SUR, patientId: "ps", doctorId: "u-doc-s", status: "PAID", total: 99_999, paid: 99_999, balance: 0 }),
    ],
    payments: [
      pago("g1", "i1", 6_000, "cash", dia(10)),
      pago("g2", "i2", 3_000, "transfer", dia(12)),
      pago("g3", "i2", 1_000, "refund", dia(20)), // reembolso real: resta el día 20
      pago("g4", "i3", 1_000, "credit", dia(15)),
      pago("g5", "iC", 5_000, "cash", dia(11)),
      pago("g6", "iM", 1_400, "migrated", dia(5)),
      pago("gs", "s1", 99_999, "cash", dia(10)),
      pago("g0", "i1", 777, "cash", new Date("2026-08-20T18:00:00Z")), // agosto: fuera del periodo
      pago("g7", "i2", 500, "anticipo", dia(29)), // aplicar el anticipo NO es ingreso
    ],
    patientCredits: [
      { id: "pc1", clinicId: CL_NORTE, patientId: "p2", amount: 500, source: "anticipo_mercadopago", creditDate: dia(28) },
      { id: "pc2", clinicId: CL_NORTE, patientId: "p2", amount: -500, source: "aplicado_a_factura", creditDate: dia(29) },
      { id: "pc3", clinicId: CL_NORTE, patientId: "p1", amount: 1_000, source: "migrated", creditDate: dia(3) },
      { id: "pcs", clinicId: CL_SUR, patientId: "ps", amount: 88_888, source: "anticipo_mercadopago", creditDate: dia(10) },
    ],
    orthodonticTreatmentPlans: [{ id: "pl1", clinicId: CL_NORTE, patientId: "p3", invoiceId: "i3", treatingDoctorId: U_DOC2_N, deletedAt: null }],
  });
}

const INGRESO_SEP = 9_500;

// ── Las puertas ────────────────────────────────────────────────────────────

test("Finanzas: ingresos $9,500 netos (anticipo el día que se cobró; sin la cancelada, la historia «migrated» ni la aplicación; menos el reembolso)", async () => {
  const db = siembra();
  const r = await calcularResumenFinanzas({ clinicId: CL_NORTE, from: SEP.gte, to: FIN_SEP, expenseTo: FIN_SEP, conSaldos: false }, db);
  assert.equal(r.ingresos, INGRESO_SEP);
  assert.equal(r.reembolsos, 1_000);
  assert.equal(r.historiaMigrada, 1_400, "la historia se enseña aparte");
  assert.equal(r.efectivo, 6_000);
});

test("Finanzas «Por doctor»: lo COBRADO, al doctor de la factura, de la cita o del caso — y suma el ingreso", async () => {
  const db = siembra();
  const r = await calcularResumenFinanzas({ clinicId: CL_NORTE, from: SEP.gte, to: FIN_SEP, expenseTo: FIN_SEP, conSaldos: false }, db);
  // El anticipo cobrado sin factura todavía no es de ningún doctor: «Sin doctor».
  assert.deepEqual(r.porDoctor.map((d) => [d.doctor, d.ingresos]), [["Hugo Salas", 6_000], ["Nadia Rojas", 3_000], ["Sin doctor", 500]]);
  assert.equal(r.porDoctor.reduce((s, d) => s + d.ingresos, 0), r.ingresos);
});

test("Inicio (tarjeta), Reportes y la gráfica: el mismo neto por mes", async () => {
  const db = siembra();
  const kpi = await ingresoNetoDelPeriodo(CL_NORTE, SEP, db);
  assert.deepEqual(kpi, { neto: INGRESO_SEP, cobrado: 10_500, reembolsos: 1_000 });
  const serie = await ingresosDelPeriodo(CL_NORTE, { gte: new Date("2026-08-01T06:00:00Z"), lt: SEP.lt }, (d) => (d < SEP.gte ? "ago" : "sep"), db);
  assert.equal(serie.porClave.sep, INGRESO_SEP);
  assert.equal(serie.porClave.ago, 777);
});

test("Sabina ingresos_por_periodo: el mismo neto", async () => {
  const db = siembra();
  const r = await ejecutarHerramienta("ingresos_por_periodo", adminNorte(db), { desde: "2026-09-01", hasta: "2026-09-30", agrupar: "mes" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal((r.datos as any).ingresosNetos, INGRESO_SEP);
});

test("nómina / comisiones: cobrado por fecha de cobro; el reembolso resta a quien cobró; la suma es el ingreso", async () => {
  const db = siembra();
  const m = await ingresosPorDoctorDelPeriodo(CL_NORTE, SEP, db);
  assert.deepEqual(m.get(U_DOC_N), { total: 6_000, orto: 0 });
  // Nadia: 3,000 de la cita − 1,000 de reembolso + 1,000 del caso de ortodoncia.
  assert.deepEqual(m.get(U_DOC2_N), { total: 3_000, orto: 1_000 });
  assert.deepEqual(m.get(null), { total: 500, orto: 0 }, "el anticipo sin factura, sin doctor");
  assert.equal(Array.from(m.values()).reduce((s, v) => s + v.total, 0), INGRESO_SEP);
});

test("la historia migrada del periodo se cuenta aparte, nunca como ingreso", async () => {
  const db = siembra();
  assert.equal(await historiaMigradaDelPeriodo(CL_NORTE, SEP, db), 1_400);
  // Y el where de ingresos la deja fuera, encima del criterio de caja.ts.
  const w = ingresoPaymentWhere(CL_NORTE, SEP) as any;
  assert.deepEqual(w.AND[1], { method: { notIn: ["migrated"] } });
});

test("deuda: $4,000 en Finanzas/Caja, la lista de Pacientes y Sabina (sin borrador ni cancelada)", async () => {
  const db = siembra();
  const agg = await (db as any).invoice.aggregate({ _sum: { balance: true }, where: deudaInvoiceWhere(CL_NORTE) });
  assert.equal(agg._sum.balance, 4_000);
  const saldos = await computeReceivables(CL_NORTE, new Date("2026-09-30T18:00:00Z"), db as any, async () => new Map());
  assert.equal(saldos.porCobrar, 4_000);
  const sabina = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(db), {});
  assert.equal(sabina.ok, true);
  if (!sabina.ok) return;
  assert.equal((sabina.datos as any).totalAdeudado, 4_000);
  assert.equal((sabina.datos as any).deudores.total, 2);
});

test("sin clínica no se consulta: `clinicId` vacío lanza en vez de traer todas las clínicas", () => {
  assert.throws(() => ingresoPaymentWhere("", SEP));
  assert.throws(() => deudaInvoiceWhere(""));
});

// ── Lo puro, con números ──────────────────────────────────────────────────

test("netoDelPeriodo: el caso de la auditoría (cobros $10,000, reembolso $1,000) da $9,000, en centavos", () => {
  const r = netoDelPeriodo(
    [{ amount: 3_333.33, paidAt: dia(1) }, { amount: 3_333.33, paidAt: dia(2) }, { amount: 3_333.34, paidAt: dia(3) }],
    [{ amount: 1_000, paidAt: dia(4) }],
    (d) => String(d.getUTCDate()),
  );
  assert.deepEqual({ neto: r.neto, cobrado: r.cobrado, reembolsos: r.reembolsos }, { neto: 9_000, cobrado: 10_000, reembolsos: 1_000 });
  assert.equal(r.porClave["4"], -1_000, "el reembolso resta el día que salió el dinero");
});

test("repartirPorDoctor: factura > cita > sin doctor; caso de ortodoncia sin cita al doctor de ese día", () => {
  const mov = (invoiceId: string, amount: number, over: Partial<Parameters<typeof repartirPorDoctor>[0]["cobros"][number]> = {}) => ({
    invoiceId, amount, paidAt: dia(10), facturaDoctorId: null, appointmentId: null, citaDoctorId: null, ...over,
  });
  const m = repartirPorDoctor({
    cobros: [
      mov("a", 1_000, { facturaDoctorId: "d1", appointmentId: "c1", citaDoctorId: "d2" }), // manda la factura
      mov("b", 500, { appointmentId: "c2", citaDoctorId: "d2" }),
      mov("c", 200),
      mov("orto", 2_000, { paidAt: dia(5) }), // antes del cambio: era de d1
      mov("orto", 3_000, { paidAt: dia(25) }), // después: es de d3
    ],
    reembolsos: [mov("b", 100, { appointmentId: "c2", citaDoctorId: "d2" })],
    casoPorFactura: new Map([["orto", "plan"]]),
    doctorActualPorCaso: new Map([["plan", "d3"]]),
    cambios: [{ planId: "plan", at: dia(15), de: "d1", a: "d3" }],
  });
  assert.deepEqual(m.get("d1"), { total: 3_000, orto: 2_000 });
  assert.deepEqual(m.get("d2"), { total: 400, orto: 0 });
  assert.deepEqual(m.get("d3"), { total: 3_000, orto: 3_000 });
  assert.deepEqual(m.get(null), { total: 200, orto: 0 });
});

test("historiaDeFactura: lo pagado antes de DaleControl, nunca negativo", () => {
  assert.equal(historiaDeFactura(8_000, 0), 8_000, "migrada sin cobros aquí");
  assert.equal(historiaDeFactura(10_000, 2_000), 8_000, "migrada con un abono hecho aquí");
  assert.equal(historiaDeFactura(3_000, 3_000), 0, "factura normal");
  assert.equal(historiaDeFactura(2_000, 3_000), 0, "un reembolso deja paid < cobros: 0, no negativo");
});

// ── Cada pantalla usa la definición única (con el código viejo, todas fallan) ──

test("Reportes: serie neta y deuda con la definición única", () => {
  const s = leer("src/app/dashboard/reports/cargar-reportes.ts");
  assert.match(s, /movimientosDelPeriodo\(clinicId/);
  assert.equal((s.match(/where: deudaInvoiceWhere\(clinicId\)/g) ?? []).length, 2);
  assert.doesNotMatch(s, /status: \{ in: \["PENDING", "PARTIAL", "OVERDUE"\] \}/);
});

test("Inicio: tarjeta, comparación, tendencia y gráfica netas; «vencidas» con computeReceivables", () => {
  assert.match(leer("src/lib/agenda/server.ts"), /ingresoNetoDelPeriodo\(clinicId, \{ gte: from, lt: to \}\)/);
  const admin = leer("src/app/api/dashboard/home/admin/route.ts");
  const revenue = leer("src/app/api/dashboard/home/revenue/route.ts");
  for (const s of [admin, revenue]) assert.doesNotMatch(s, /method: \{ not: "refund" \}/);
  assert.match(admin, /ingresoNetoDelPeriodo\(clinicId, \{ gte: prevFrom, lt: prevSameTo \}\)/);
  assert.match(admin, /computeReceivables\(clinicId, new Date\(\)\)/);
  assert.match(revenue, /movimientosDelPeriodo\(session\.clinic\.id/);
});

test("nómina y analítica de doctores: lo cobrado por fecha de cobro, no Invoice.paid por fecha de cita", () => {
  for (const f of ["src/app/api/analytics/payroll-pdf/route.ts", "src/app/api/analytics/doctor-performance/route.ts"]) {
    const s = leer(f);
    assert.match(s, /ingresosPorDoctorDelPeriodo\(clinicId, \{ gte: from, lte: to \}\)/, f);
    assert.doesNotMatch(s, /_sum: \{ paid: true \}/, f);
  }
});

test("Pacientes: la columna «Saldo», «Con deuda» y los KPIs sin borradores", () => {
  const s = leer("src/app/api/patients/route.ts");
  assert.equal((s.match(/where: deudaInvoiceWhere\(ctx\.clinicId\)/g) ?? []).length, 3);
  assert.doesNotMatch(s, /balance: \{ gt: 0 \}, status: \{ not: "CANCELLED" \}/);
});

test("Caja: «Total cobrado» sin la historia migrada, que va aparte", () => {
  const page = leer("src/app/dashboard/caja/page.tsx");
  assert.match(page, /historiaMigradaDeFacturas\(user\.clinicId\)/);
  assert.match(page, /\(paidAgg\._sum\.paid \?\? 0\) - historiaMigrada/);
  assert.match(leer("src/app/dashboard/billing/billing-client.tsx"), /clave="cajaHistoriaMigrada"/);
  const sql = leer("src/lib/dinero/ingresos.server.ts");
  assert.match(sql, /GREATEST\(i\."paid" - COALESCE\(p\.cobrado, 0\), 0\)/);
  assert.match(sql, /i\."status" NOT IN \('DRAFT', 'CANCELLED'\)/);
});

test("los textos «Qué cuenta» dicen cobrado y fecha de cobro, en es y en", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).queCuenta;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).queCuenta;
  assert.match(es.porDoctor, /COBRADO/);
  assert.match(en.porDoctor, /COLLECTED/);
  for (const k of ["historiaMigrada", "cajaHistoriaMigrada", "inicioIngresos"]) {
    assert.equal(typeof es[k], "string", k);
    assert.equal(typeof en[k], "string", k);
  }
  assert.match(es.reportesConDeuda, /sin borradores ni canceladas/);
  // Inicio dice su «Qué cuenta» en las dos tarjetas de ingresos.
  for (const f of ["src/components/dashboard/hoy-rediseno/tarjeta-ingresos.tsx", "src/components/dashboard/home/parts/revenue-trend-card.tsx"]) {
    assert.match(leer(f), /<QueCuenta clave="inicioIngresos" \/>/, f);
  }
});
