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

// ── C-02 / C-03 · qué pasa con la factura al reembolsar ────────────────────
import { efectoDelReembolso } from "@/lib/dinero/reembolso-destino";
import { reajustarAlTotal } from "@/lib/invoices/reajustar-total";

test("C-02 · MF-1128 ($3,000 pagada, devuelve $1,000): «baja el total» → $2,000 pagada; «sigue debiendo» → parcial $1,000", () => {
  assert.deepEqual(efectoDelReembolso({ total: 3_000, pagado: 3_000, monto: 1_000, destino: "baja_total" }),
    { pagado: 2_000, total: 2_000, saldo: 0, estado: "PAID", bajaDelTotal: 1_000 });
  assert.deepEqual(efectoDelReembolso({ total: 3_000, pagado: 3_000, monto: 1_000, destino: "sigue_debiendo" }),
    { pagado: 2_000, total: 3_000, saldo: 1_000, estado: "PARTIAL", bajaDelTotal: 0 });
  // Devolver todo «baja el total» = no queda nada: cancelada.
  assert.equal(efectoDelReembolso({ total: 3_000, pagado: 3_000, monto: 3_000, destino: "baja_total" }).estado, "CANCELLED");
});

test("C-02 · MF-1125 ($640 con $160 de descuento, devuelve $100 de más): total $540 y nada por cobrar", () => {
  const e = efectoDelReembolso({ total: 640, pagado: 640, monto: 100, destino: "baja_total" });
  assert.equal(e.total, 540);
  assert.equal(e.saldo, 0);
  assert.equal(e.estado, "PAID");
});

test("C-03 · MF-1131 Parcial ($500 de $3,500): devolver todo → CANCELADA; quedarse con lo pagado → $500 PAGADA", () => {
  assert.equal(efectoDelReembolso({ total: 3_500, pagado: 500, monto: 500, destino: "baja_resto" }).estado, "CANCELLED");
  assert.deepEqual(efectoDelReembolso({ total: 3_500, pagado: 500, monto: 0, destino: "baja_resto" }),
    { pagado: 500, total: 500, saldo: 0, estado: "PAID", bajaDelTotal: 3_000 });
  // Parcial que «baja el total» conserva lo que debía.
  assert.equal(efectoDelReembolso({ total: 4_000, pagado: 1_500, monto: 500, destino: "baja_total" }).saldo, 2_500);
  assert.throws(() => efectoDelReembolso({ total: 3_000, pagado: 3_000, monto: 3_001, destino: "baja_total" }));
  assert.throws(() => efectoDelReembolso({ total: 3_000, pagado: 3_000, monto: 0, destino: "sigue_debiendo" }));
});

test("C-02 · bajar el total respeta los conceptos (descuento explícito) y el IVA agregado", () => {
  const r = reajustarAlTotal({ items: [{ description: "Endodoncia", quantity: 1, unitPrice: 3_000, total: 3_000 }], discount: 0, taxRate: 16, taxIncluded: true }, 2_000);
  assert.equal(r.total, 2_000);
  assert.equal(r.discount, 1_000);
  assert.equal(r.subtotal, 3_000);
  const iva = reajustarAlTotal({ items: [{ description: "Corona", quantity: 1, unitPrice: 1_000, total: 1_000 }], discount: 0, taxRate: 16, taxIncluded: false }, 580);
  assert.equal(iva.total, 580, "base $500 + 16 %");
  assert.equal(iva.discount, 500);
});

// ── C-32 · método con más dinero ──────────────────────────────────────────
import { metodoPrincipal, reembolsadoDeFactura } from "@/lib/invoices/metodo-principal";

test("C-32 · $3,500 por transferencia y un abono de $100 en efectivo: el método es «transferencia» (antes «efectivo», el último)", () => {
  const pagos = [
    { method: "transfer", amount: 3_500 },
    { method: "cash", amount: 100 },
    { method: "refund", amount: 3_600, refundMethod: "cash" },
  ];
  assert.equal(metodoPrincipal(pagos, "cash"), "transfer");
  assert.equal(metodoPrincipal([], "cash"), "cash", "sin cobros, el de la factura");
  assert.deepEqual(reembolsadoDeFactura([...pagos, { method: "refund", amount: 500, refundMethod: "saldo_a_favor" }]), { devuelto: 3_600, aSaldoAFavor: 500 });
});

// ── C-02 / C-19 · comprobante PDF ─────────────────────────────────────────
import { fmtFecha, renglonDePago } from "@/lib/invoices/print-pdf";

test("C-02 · el comprobante pone el reembolso en negativo y dice por dónde salió (antes «Reembolso $1,000» como pago)", () => {
  assert.deepEqual(renglonDePago({ method: "refund", amount: 1_000, refundMethod: "cash" }), { etiqueta: "Reembolso (en efectivo)", signo: "-", resta: true });
  assert.equal(renglonDePago({ method: "refund", amount: 500, refundMethod: "saldo_a_favor" }).etiqueta, "Pasó a saldo a favor");
  assert.equal(renglonDePago({ method: "refund", amount: 500, refundMethod: null }).signo, "-", "uno viejo sin método también resta (guion ASCII: la Helvetica del PDF no trae el menos tipográfico)");
  assert.deepEqual(renglonDePago({ method: "cash", amount: 3_000 }), { etiqueta: "Efectivo", signo: "", resta: false });
});

test("C-19 · un cobro del 3-oct a las 23:12 en CDMX sale «3 de octubre» (antes «4 de octubre», hora del servidor)", () => {
  const cobro = new Date("2026-10-04T05:12:00.000Z");
  assert.equal(fmtFecha(cobro, "America/Mexico_City"), "3 de octubre de 2026");
  assert.equal(fmtFecha(cobro, "Europe/Madrid"), "4 de octubre de 2026");
  assert.equal(fmtFecha(cobro), "3 de octubre de 2026", "sin zona, la de México");
});

// ── C-06 / C-17 · caja ────────────────────────────────────────────────────
import { cambioDelEsperado, descuentoUnaVezPorFactura } from "@/lib/dinero/caja-core";

test("C-06 · el esperado cambió desde que se abrió el diálogo: $4,740 → $8,740 = +$4,000; sin cambio o sin dato, null", () => {
  assert.deepEqual(cambioDelEsperado(4_740, 8_740), { diferencia: 4_000 });
  assert.deepEqual(cambioDelEsperado(4_740, 4_240), { diferencia: -500 });
  assert.equal(cambioDelEsperado(4_740, 4_740.004), null);
  assert.equal(cambioDelEsperado(undefined, 8_740), null, "una pestaña vieja que no manda lo que vio cierra como antes");
});

test("C-17 · factura de $800 con $160 de descuento cobrada en $300 + $100: la tabla dice −$160 una vez (antes −$75 y −$25)", () => {
  const m = descuentoUnaVezPorFactura([
    { paymentId: "p1", invoiceId: "mf1125", invoiceDiscount: 160, method: "cash" },
    { paymentId: "p2", invoiceId: "mf1125", invoiceDiscount: 160, method: "cash" },
    { paymentId: "r1", invoiceId: "mf1125", invoiceDiscount: 160, method: "refund" },
    { paymentId: "p3", invoiceId: "mf2", invoiceDiscount: 0, method: "debit" },
  ]);
  assert.deepEqual(Array.from(m.entries()), [["p1", 160]]);
});

// ── C-15 · transferencia sin referencia, en los tres cobros ────────────────
import { readFileSync } from "node:fs";
import path from "node:path";

test("C-15 · «Registrar pago» (las dos ventanas) y «Cobrar hoy» piden la referencia de una transferencia, como el anticipo", () => {
  const raiz = path.resolve(__dirname, "../../../..");
  const leer = (rel: string) => readFileSync(path.join(raiz, rel), "utf8");
  assert.match(leer("src/components/dashboard/factura-un-popup/use-cobro.ts"), /if \(method === "transfer" && !reference\.trim\(\)\) \{ toast\.error\(txCobro\.faltaReferencia\); return; \}/);
  assert.match(leer("src/components/dashboard/billing/payment-modal.tsx"), /if \(method === "transfer" && !reference\.trim\(\)\) \{ toast\.error\(txCobro\.faltaReferencia\); return; \}/);
  assert.match(leer("src/components/dashboard/cobrar-hoy/cobrar-hoy.tsx"), /pagoEfectivo > 0 && metodo === "transfer" && !referencia\.trim\(\)/);
  // Y «Cobrar hoy» manda el doctor elegido (C-07).
  assert.match(leer("src/components/dashboard/cobrar-hoy/cobrar-hoy.tsx"), /\.\.\.\(doctorTocado \? \{ doctorId: doctorId \|\| null \} : \{\}\)/);
});

import { cuerpoNotaCobroHoy } from "@/lib/invoices/cobrar-hoy";
test("C-07 · el cuerpo de «Cobrar hoy» lleva el doctor elegido; sin elegir, no lo manda (lo hereda el servidor)", () => {
  const base = { patientId: "p1", conceptos: [{ nombre: "Limpieza", importe: 1_200 }] };
  assert.equal((cuerpoNotaCobroHoy({ ...base, doctorId: "docA" }) as any).doctorId, "docA");
  assert.equal((cuerpoNotaCobroHoy({ ...base, doctorId: null }) as any).doctorId, null, "«Sin asignar» a propósito");
  assert.equal("doctorId" in cuerpoNotaCobroHoy(base), false);
});

// ── C-33 · las fechas por defecto en la zona de la clínica ─────────────────
import { hoyDeLaClinica } from "@/lib/billing/zona-clinica";
import { paidAtInstant } from "@/lib/billing/paid-at";

test("C-33 · a las 23:03 del sábado 3 en CDMX, el «hoy» de la clínica es el 3 (la compu en Nueva York ya decía 4)", () => {
  const ahora = new Date("2026-10-04T05:03:00.000Z");
  assert.equal(hoyDeLaClinica("America/Mexico_City", ahora), "2026-10-03");
  assert.equal(hoyDeLaClinica("America/New_York", ahora), "2026-10-04");
  assert.equal(hoyDeLaClinica("Zona/Inventada", ahora).length, 10, "una zona inválida cae a la del navegador sin romper");
  // Elegido «hoy» de la clínica → el instante real del cobro, aunque el navegador ya esté en otro día.
  assert.equal(paidAtInstant("2026-10-03", ahora, "2026-10-03")?.getTime(), ahora.getTime());
});

// ── C-18 · Movimientos que se leían vagos ─────────────────────────────────
import { redactarMovimiento } from "@/lib/movimientos-paciente/catalogo";

test("C-18 · traspaso a saldo a favor, anticipo pedido, firma del doctor y estado del caso dicen qué pasó (antes «Actualizó una factura: 1 dato más»)", () => {
  assert.equal(
    redactarMovimiento({ entityType: "invoice", action: "update", changes: { dineroCitaCancelada: { before: null, after: { decision: "a_favor", monto: 500, quien: "Ana" } } } }),
    "Pasó a saldo a favor lo pagado de una cita cancelada",
  );
  assert.equal(
    redactarMovimiento({ entityType: "invoice", action: "update", changes: { dineroCitaCancelada: { before: "reembolso", after: { devuelto: 300, facturaCancelada: true } } } }),
    "Registró que devolvió lo pagado de una cita cancelada y canceló su factura",
  );
  assert.equal(
    redactarMovimiento({ entityType: "appointment", action: "update", changes: { anticipo: { before: null, after: { monto: 500 } } } }),
    "Pidió un anticipo para una cita",
  );
  assert.equal(
    redactarMovimiento({ entityType: "consent", action: "update", changes: { doctorSignedAt: { before: null, after: "x" }, doctorId: { before: null, after: "d" }, a: {}, b: {} } }),
    "El doctor firmó un consentimiento",
  );
  assert.equal(
    redactarMovimiento({ entityType: "orthodontic-case", action: "ortho.treatmentPlan.statusChanged", changes: { status: { before: "PLANNED", after: "IN_PROGRESS" } } }),
    "Cambió el caso de ortodoncia de «Planeado» a «En tratamiento»",
  );
  // Lo que no se reconoce sigue como antes.
  assert.equal(redactarMovimiento({ entityType: "invoice", action: "update", changes: { notes: { before: "a", after: "b" } } }), "Actualizó una factura: notas");
});

// ── Decisión 16 · cobrar en la caja que abrió otra persona: AVISAR ─────────
import { cajaAbiertaDeRespuesta, cajaDeOtraPersona } from "@/components/dashboard/billing/aviso-caja-cerrada";

test("decisión 16 · la caja la abrió otra persona → su nombre; la propia, cerrada o sin respuesta → nada", () => {
  assert.equal(cajaDeOtraPersona(200, { register: { operatorName: "Cuenta de Prueba", esMia: false } }), "Cuenta de Prueba");
  assert.equal(cajaDeOtraPersona(200, { register: { operatorName: "Yo", esMia: true } }), null);
  assert.equal(cajaDeOtraPersona(200, { register: null }), null);
  assert.equal(cajaDeOtraPersona(403, { error: "x" }), null);
  // Y la misma respuesta dice si está abierta (recepción ya se entera de la caja cerrada).
  assert.equal(cajaAbiertaDeRespuesta(200, { register: null }), false);
});

// ── C-28 · el enlace del plan cuenta como la cabecera ─────────────────────
import { textosDinero } from "@/lib/dinero/textos";
test("C-28 · «Cuota 1 de 3» arriba y el enlace dice «Ver el enganche y las 3 cuotas del plan» (antes «Ver los 4 pagos»)", () => {
  assert.equal(textosDinero("es").plan.verEngancheYCuotas(3), "Ver el enganche y las 3 cuotas del plan");
  assert.equal(textosDinero("es").plan.verCuotas(1), "Ver la cuota del plan");
});
