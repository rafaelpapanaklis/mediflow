/**
 * «Abonar a otra factura» (decisión de Rafael, 4-oct-2026) — ws1-t5.
 *
 * Run: npm run test:abono-otra-factura
 *
 * El ejemplo de Rafael con números: F1 $500 y F2 $700; paga $700 en F1 → F1
 * pagada, F2 «Pagado $200 · Saldo $500» (total intacto $700); luego paga $500 →
 * F2 pagada. Y que Caja, Finanzas y la cuenta por doctor vean UN ingreso de $700
 * por el cobro real (no $900, ni $700 + $200).
 *
 * Sin `--experimental-test-module-mocks`: `abono.server.ts` lleva
 * `import "server-only"`. Se parchea `Module._load` (como en
 * agenda-bloqueos/politica.test.ts) para ese paquete, el `prisma` real y el
 * segundo factor (que arrastra `cache()` de React).
 */
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  if (req === "server-only") return {};
  if (req === "@/lib/prisma") return { prisma: { get $connect(): never { throw new Error("la prueba usó el prisma real"); } } };
  if (req === "@/lib/auth/two-factor-identity") return { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false };
  return cargaOriginal.call(this, req, ...r);
};

import { conceptoDeFactura, facturasAbonables, notasDelAbono, repartirConAbono } from "@/lib/dinero/abono-core";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

// ── El reparto, puro ────────────────────────────────────────────────────────
test("reparto · el ejemplo de Rafael: paga $700 en F1 ($500) con abono a F2 ($700) → $500 a F1, $200 a F2, nada a favor", () => {
  assert.deepEqual(repartirConAbono({ monto: 700, faltaCobrada: 500, faltaDestino: 700 }), { enCobrada: 500, enDestino: 200, aFavor: 0, excedente: 200 });
});

test("reparto · sin elegir factura, lo de más queda a favor ($200)", () => {
  assert.deepEqual(repartirConAbono({ monto: 700, faltaCobrada: 500, faltaDestino: null }), { enCobrada: 500, enDestino: 0, aFavor: 200, excedente: 200 });
});

test("reparto · lo de más pasa del saldo de la elegida: $1,000 en F1 ($500) con F2 debiendo $300 → $500 / $300 / $200 a favor", () => {
  assert.deepEqual(repartirConAbono({ monto: 1_000, faltaCobrada: 500, faltaDestino: 300 }), { enCobrada: 500, enDestino: 300, aFavor: 200, excedente: 500 });
});

test("reparto · en centavos: $100.01 entre $33.33 y $66.67 no pierde ni crea centavos", () => {
  const r = repartirConAbono({ monto: 100.01, faltaCobrada: 33.33, faltaDestino: 66.67 });
  assert.deepEqual(r, { enCobrada: 33.33, enDestino: 66.67, aFavor: 0.01, excedente: 66.68 });
  assert.equal(Math.round((r.enCobrada + r.enDestino + r.aFavor) * 100), 10_001);
});

test("reparto · desde una factura ya pagada (el botón): todo va a la elegida", () => {
  assert.deepEqual(repartirConAbono({ monto: 200, faltaCobrada: 0, faltaDestino: 700 }), { enCobrada: 0, enDestino: 200, aFavor: 0, excedente: 200 });
});

test("lista · solo las demás facturas con saldo y que reciben pagos, la más vieja primero, con folio, concepto y saldo", () => {
  const l = facturasAbonables([
    { id: "f1", invoiceNumber: "MF-1", status: "PENDING", total: 500, paid: 0, items: [{ description: "Limpieza" }], createdAt: new Date("2026-10-01") },
    { id: "f3", invoiceNumber: "MF-3", status: "PARTIAL", total: 1_000, paid: 400, items: [{ description: "Corona" }, { description: "Poste" }], createdAt: new Date("2026-10-03") },
    { id: "f2", invoiceNumber: "MF-2", status: "PENDING", total: 700, paid: 0, items: [{ description: "Resina" }], createdAt: new Date("2026-10-02") },
    { id: "f4", invoiceNumber: "MF-4", status: "PAID", total: 300, paid: 300, items: [], createdAt: new Date("2026-09-01") },
    { id: "f5", invoiceNumber: "MF-5", status: "CANCELLED", total: 300, paid: 0, items: [], createdAt: new Date("2026-09-01") },
    { id: "f6", invoiceNumber: "MF-6", status: "DRAFT", total: 300, paid: 0, items: [], createdAt: new Date("2026-09-01") },
  ], "f1");
  assert.deepEqual(l.map((f) => [f.invoiceNumber, f.concepto, f.saldo]), [["MF-2", "Resina", 700], ["MF-3", "Corona · +1", 600]]);
  assert.equal(conceptoDeFactura([]), "");
});

test("notas · los pagos del mismo cobro quedan ligados por el mismo «cobro #…»", () => {
  const n = notasDelAbono({ cobroId: "ab12cd34", monto: 700, folioCobrada: "MF-1", folioDestino: "MF-2", reparto: repartirConAbono({ monto: 700, faltaCobrada: 500, faltaDestino: 700 }) });
  assert.match(n.cobrada, /Cobro de \$700\.00 \(cobro #ab12cd34\): \$500\.00 a esta factura, \$200\.00 abonados a la factura MF-2/);
  assert.match(n.destino, /parte del cobro de \$700\.00 registrado en la factura MF-1 \(cobro #ab12cd34\)/);
});

// ── El servidor, contra una base en memoria ─────────────────────────────────
type Fila = Record<string, any>;
function baseEnMemoria(inicio: { invoices: Fila[] }) {
  const invoices = inicio.invoices.map((f) => ({ ...f }));
  const payments: Fila[] = [];
  const patientCredits: Fila[] = [];
  let n = 0;
  const tx: any = {
    $queryRaw: async () => [],
    invoice: {
      findMany: async ({ where }: any) =>
        invoices.filter((f) => f.clinicId === where.clinicId && (where.id?.in ? where.id.in.includes(f.id) : true)).map((f) => ({ ...f })),
      updateMany: async ({ where, data }: any) => {
        const f = invoices.find((x) => x.id === where.id && x.clinicId === where.clinicId);
        if (f) Object.assign(f, data);
        return { count: f ? 1 : 0 };
      },
    },
    payment: { create: async ({ data }: any) => { const p = { id: `pg${++n}`, refundMethod: null, ...data }; payments.push(p); return { id: p.id }; } },
    patientCredit: { create: async ({ data }: any) => { const c = { id: `cr${++n}`, ...data }; patientCredits.push(c); return c; } },
  };
  return { db: { $transaction: async (fn: any) => fn(tx), invoice: tx.invoice } as any, invoices, payments, patientCredits };
}

const CL = "clinica_qa";
const HOY = new Date("2026-10-04T17:00:00Z");
const F1 = { id: "f1", clinicId: CL, patientId: "p1", invoiceNumber: "MF-1", status: "PENDING", total: 500, paid: 0, balance: 500, subtotal: 500, discount: 0, taxRate: 0, taxIncluded: true, doctorId: "doc1", appointmentId: null, notes: null, items: [{ description: "Limpieza", quantity: 1, unitPrice: 500, total: 500 }], createdAt: new Date("2026-10-04T15:00:00Z") };
const F2 = { id: "f2", clinicId: CL, patientId: "p1", invoiceNumber: "MF-2", status: "PENDING", total: 700, paid: 0, balance: 700, subtotal: 700, discount: 0, taxRate: 0, taxIncluded: true, doctorId: "doc2", appointmentId: null, notes: null, items: [{ description: "Resina", quantity: 1, unitPrice: 700, total: 700 }], createdAt: new Date("2026-10-04T15:01:00Z") };

test("servidor · el ejemplo de Rafael completo: paga $700 en F1 con abono a F2; luego $500 en F2", async () => {
  const { cobrarConAbono } = await import("@/lib/dinero/abono.server");
  const b = baseEnMemoria({ invoices: [F1, F2] });
  const r = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f1", destinoId: "f2", amount: 700, method: "cash", paidAt: HOY }, b.db);
  assert.ok(r.ok, JSON.stringify(r));
  const f1 = b.invoices.find((f) => f.id === "f1")!;
  const f2 = b.invoices.find((f) => f.id === "f2")!;
  assert.deepEqual([f1.status, f1.paid, f1.balance], ["PAID", 500, 0]);
  assert.deepEqual([f2.status, f2.total, f2.paid, f2.balance], ["PARTIAL", 700, 200, 500], "«Pagado $200 · Saldo $500», total intacto $700");
  assert.deepEqual(b.payments.map((p) => [p.invoiceId, p.amount, p.method]), [["f1", 500, "cash"], ["f2", 200, "cash"]], "un Payment por factura con el método real");
  const cobro = (b.payments[0].notes.match(/cobro #(\w+)/) ?? [])[1];
  assert.ok(cobro && b.payments[1].notes.includes(`cobro #${cobro}`), "los dos pagos, ligados al mismo cobro");
  assert.equal(b.patientCredits.length, 0);

  // Segunda cita: paga $500 en F2 (el cobro de siempre o este, sin abono) → pagada.
  const r2 = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f2", destinoId: null, amount: 500, method: "debit", paidAt: HOY }, b.db);
  assert.ok(r2.ok);
  assert.deepEqual([f2.status, f2.paid, f2.balance], ["PAID", 700, 0]);
});

test("servidor · lo de más pasa del saldo de la elegida: el resto queda a favor (Payment real + traspaso + fila del libro)", async () => {
  const { cobrarConAbono } = await import("@/lib/dinero/abono.server");
  const b = baseEnMemoria({ invoices: [F1, { ...F2, total: 300, balance: 300 }] });
  const r = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f1", destinoId: "f2", amount: 1_000, method: "transfer", reference: "SPEI1", paidAt: HOY }, b.db);
  assert.ok(r.ok && r.reparto.aFavor === 200);
  assert.deepEqual(b.payments.map((p) => [p.invoiceId, p.amount, p.method, p.refundMethod ?? null]), [
    ["f1", 500, "transfer", null], ["f2", 300, "transfer", null], ["f1", 200, "transfer", null], ["f1", 200, "refund", "saldo_a_favor"],
  ]);
  assert.deepEqual(b.patientCredits.map((c) => [c.amount, c.source, c.patientId, c.clinicId]), [[200, "excedente_de_cobro", "p1", CL]]);
});

test("servidor · sin elegir factura, lo de más va a favor; y las puertas: otro paciente, misma factura, ya pagada, otra clínica", async () => {
  const { cobrarConAbono } = await import("@/lib/dinero/abono.server");
  const b = baseEnMemoria({ invoices: [F1, F2, { ...F2, id: "fx", patientId: "otro", invoiceNumber: "MF-9" }, { ...F2, id: "fz", clinicId: "otra", invoiceNumber: "MF-Z" }] });
  const sin = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f1", destinoId: null, amount: 700, method: "cash", paidAt: HOY }, b.db);
  assert.ok(sin.ok && sin.reparto.aFavor === 200 && sin.reparto.enDestino === 0);
  const ajeno = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f2", destinoId: "fx", amount: 800, method: "cash", paidAt: HOY }, b.db);
  assert.ok("error" in ajeno && /MISMO paciente/.test(ajeno.error));
  const misma = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f2", destinoId: "f2", amount: 800, method: "cash", paidAt: HOY }, b.db);
  assert.ok(!misma.ok);
  const pagada = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f2", destinoId: "f1", amount: 800, method: "cash", paidAt: HOY }, b.db);
  assert.ok("error" in pagada && /ya no recibe pagos/.test(pagada.error), "F1 ya está pagada");
  const otraClinica = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f2", destinoId: "fz", amount: 800, method: "cash", paidAt: HOY }, b.db);
  assert.ok("error" in otraClinica && otraClinica.status === 404, "la factura de otra clínica no existe para esta");
});

// ── Las demás pantallas cuadran: UN ingreso por el cobro real ───────────────
test("Caja, Finanzas y por doctor: el cobro de $700 entra UNA vez ($500 de F1 + $200 de F2, no $900); cfdiCuadre de las dos facturas", async () => {
  const { cobrarConAbono } = await import("@/lib/dinero/abono.server");
  const { crearBase } = await import("@/lib/sabina/tools/__tests__/doble-base");
  const { deriveWindow } = await import("@/lib/caja");
  const { ingresoNetoDelPeriodo, ingresosPorDoctorDelPeriodo } = await import("@/lib/dinero/ingresos.server");
  const { cfdiCuadre } = await import("@/lib/invoices/cfdi-cuadre");

  const b = baseEnMemoria({ invoices: [F1, F2] });
  const r = await cobrarConAbono({ clinicId: CL, userId: "u1", invoiceId: "f1", destinoId: "f2", amount: 700, method: "cash", paidAt: HOY }, b.db);
  assert.ok(r.ok);
  const lectura = crearBase({
    clinics: [{ id: CL, timezone: "America/Mexico_City", category: "DENTAL", cfdiTaxMode: "exempt" }],
    users: [{ id: "doc1", clinicId: CL, firstName: "Ana", lastName: "Uno", role: "DOCTOR" }, { id: "doc2", clinicId: CL, firstName: "Beto", lastName: "Dos", role: "DOCTOR" }],
    patients: [{ id: "p1", clinicId: CL, firstName: "Paciente", lastName: "Prueba", status: "ACTIVE", visibleUserIds: [] }],
    invoices: b.invoices,
    payments: b.payments,
    patientCredits: b.patientCredits,
  }) as any;
  const desde = new Date("2026-10-04T06:00:00Z");
  const hasta = new Date("2026-10-05T05:59:59Z");

  const caja = await deriveWindow(CL, desde, hasta, { db: lectura });
  assert.equal(caja.cashIncome, 700, "Caja › efectivo del turno: los $700 que entraron al cajón");
  assert.equal(caja.totalIncome, 700);

  const fin = await ingresoNetoDelPeriodo(CL, { gte: desde, lte: hasta }, lectura);
  assert.equal(fin.neto, 700, "Finanzas › ingresos: $700, una vez");

  const porDoctor = await ingresosPorDoctorDelPeriodo(CL, { gte: desde, lte: hasta }, lectura);
  assert.equal(porDoctor.get("doc1")?.total, 500, "lo de F1 a su doctor");
  assert.equal(porDoctor.get("doc2")?.total, 200, "lo abonado a F2 a SU doctor");
  const suma = Array.from(porDoctor.values()).reduce((a, v) => a + v.total, 0);
  assert.equal(suma, 700, "la suma por doctor es el ingreso");

  // Estado de cuenta del paciente: facturado $1,200, pagado $700, debe $500.
  const facturado = b.invoices.reduce((a, f) => a + f.total, 0);
  const pagado = b.invoices.reduce((a, f) => a + f.paid, 0);
  assert.deepEqual([facturado, pagado, facturado - pagado], [1_200, 700, 500]);

  // El total de ninguna factura cambió: las dos siguen cuadrando para timbrar.
  for (const f of b.invoices) {
    assert.ok(cfdiCuadre({ items: f.items, discount: f.discount, total: f.total, taxMode: "exento", taxIncluded: true }).ok, f.invoiceNumber);
  }
});

test("ruta · mismas puertas que el cobro de siempre", () => {
  const ruta = leer("src/app/api/invoices/[id]/abonar/route.ts");
  assert.match(ruta, /denyIfMissingPermission\(ctx, permiso\)/);
  assert.match(ruta, /contexto\(params\.id, "billing\.charge"\)/);
  assert.match(ruta, /assertPatientVisible\(inv\.patientId/);
  assert.match(ruta, /where: \{ id: invoiceId, clinicId: ctx\.clinicId \}/);
  assert.match(ruta, /method === METODO_MERCADO_PAGO/);
  assert.match(ruta, /method === METODO_ANTICIPO/);
  assert.match(ruta, /frenoCobroDoble\(/);
  assert.match(ruta, /La fecha de pago no puede ser futura/);
});

// ── QA ws1-t3 (encargo 4): un cobro repartido cuenta como UN cobro ──────────
test("número de cobros: los Payment de un mismo «cobro #…» (y su excedente a favor) cuentan UNA vez; ticket promedio $700, no $350", async () => {
  const { contarCobros, cobroDeLaNota } = await import("@/lib/dinero/abono-core");
  const filas = [
    { amount: 500, notes: "Cobro de $700.00 (cobro #cd762d21): $500.00 a esta factura, $200.00 abonados a la factura MF-1192" },
    { amount: 200, notes: "Abono: parte del cobro de $700.00 registrado en la factura MF-1191 (cobro #cd762d21)" },
    { amount: 300, notes: null },
    { amount: 50, notes: "Excedente del cobro de $350.00 (cobro #0a1b2c3d): pasa al saldo a favor del paciente" },
    { amount: 300, notes: "Cobro de $350.00 (cobro #0a1b2c3d): $300.00 a esta factura, $50.00 a favor del paciente" },
  ];
  assert.equal(cobroDeLaNota(filas[0].notes), "cd762d21");
  assert.equal(contarCobros(filas), 3, "antes: 5 cobros");
  const sabina = leer("src/lib/sabina/tools/ingresos-por-periodo.ts");
  assert.match(sabina, /const numeroDeCobros = contarCobros\(/);
  assert.match(sabina, /ticketPromedio: numeroDeCobros > 0 \? money\(brutos \/ numeroDeCobros\) : null/);
  assert.match(leer("src/lib/dinero/ingresos.server.ts"), /select: \{ amount: true, paidAt: true, notes: true \}/);
});

test("QA 1a · el monto del cobro y el del abono se seleccionan enteros al enfocarse (antes: «500» + teclear 700 = 500700)", () => {
  const seccion = leer("src/components/dashboard/factura-un-popup/seccion-cobro.tsx");
  assert.match(seccion, /onFocus=\{\(e\) => \{ setTecleando\(true\); seleccionarAlEnfocar\(e\); \}\}/);
  assert.match(seccion, /onMouseUp=\{conservarSeleccion\}/);
  assert.match(leer("src/components/dashboard/billing/dialogo-abonar.tsx"), /onFocus=\{seleccionarAlEnfocar\}/);
  const sel = leer("src/components/dashboard/factura-un-popup/seleccionar-al-enfocar.ts");
  assert.match(sel, /setTimeout\(\(\) => \{[\s\S]*?el\.select\(\)/);
  assert.match(sel, /e\.preventDefault\(\);/);
});
