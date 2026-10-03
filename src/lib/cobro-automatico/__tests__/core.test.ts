/**
 * Cobro automático con tarjeta (ws1-t6) — la parte pura.
 *
 * Run: npm run test:cobro-automatico
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ajusteNecesario,
  cobroDeRef,
  correoValido,
  cuotaQueCubre,
  decidirCobro,
  desfaseDeZona,
  frecuenciaMp,
  isoEnZona,
  linkSeguro,
  planDeCobro,
  refDeCobro,
  type CobroMp,
} from "../core";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";

// $24,000: enganche $6,000 el 5-ene-2026 y 6 mensualidades de $3,000 (5-feb … 5-jul).
const PLAN: CondicionesPago = {
  modo: "plazos",
  metodo: "credit",
  enganche: 6000,
  numPagos: 6,
  frecuencia: "MONTHLY",
  primerPago: "2026-01-05",
  difiereConSuBanco: false,
};

const base = { condiciones: PLAN, total: 24000, estadoFactura: "PARTIAL" };

test("plan: la siguiente mensualidad DESPUÉS de hoy, por su importe, hasta la última", () => {
  const r = planDeCobro({ ...base, pagado: 9000, hoy: "2026-02-20" });
  assert.equal(r.motivo, null);
  assert.deepEqual(r.plan, {
    monto: 3000,
    inicio: "2026-03-05",
    fin: "2026-07-05",
    frecuencia: "MONTHLY",
    cuotaInicial: 2,
    totalCuotas: 6,
    pendiente: 15000,
  });
});

test("plan: lo vencido NO se cobra solo — arranca en la siguiente fecha futura", () => {
  // Solo pagó el enganche y ya pasaron febrero y marzo.
  const r = planDeCobro({ ...base, pagado: 6000, hoy: "2026-03-20" });
  assert.equal(r.plan?.inicio, "2026-04-05");
  assert.equal(r.plan?.monto, 3000);
});

test("plan: la cuota de HOY no se cobra hoy (estrictamente después)", () => {
  const r = planDeCobro({ ...base, pagado: 6000, hoy: "2026-02-05" });
  assert.equal(r.plan?.inicio, "2026-03-05");
});

test("plan: al final, nunca más de lo que falta", () => {
  const r = planDeCobro({ ...base, pagado: 22500, hoy: "2026-06-10" });
  assert.equal(r.plan?.monto, 1500);
  assert.equal(r.plan?.pendiente, 1500);
});

test("plan: por qué no", () => {
  assert.equal(planDeCobro({ ...base, pagado: 24000, hoy: "2026-02-01" }).motivo, "saldada");
  assert.equal(planDeCobro({ ...base, estadoFactura: "CANCELLED", pagado: 0, hoy: "2026-02-01" }).motivo, "cancelada");
  assert.equal(planDeCobro({ ...base, condiciones: { ...PLAN, modo: "unico" }, pagado: 0, hoy: "2026-02-01" }).motivo, "no_a_plazos");
  assert.equal(planDeCobro({ ...base, condiciones: null, pagado: 0, hoy: "2026-02-01" }).motivo, "no_a_plazos");
  assert.equal(planDeCobro({ ...base, condiciones: { ...PLAN, primerPago: null }, pagado: 0, hoy: "2026-02-01" }).motivo, "sin_fechas");
  assert.equal(planDeCobro({ ...base, pagado: 6000, hoy: "2026-08-01" }).motivo, "sin_cuotas_futuras");
  assert.equal(planDeCobro({ ...base, pagado: 23995, hoy: "2026-06-10" }).motivo, "bajo_minimo");
});

test("frecuencia exacta: mensual = 1 mes, semanal = 7 días, catorcenal = 14 días", () => {
  assert.deepEqual(frecuenciaMp("MONTHLY"), { frequency: 1, frequency_type: "months" });
  assert.deepEqual(frecuenciaMp("WEEKLY"), { frequency: 7, frequency_type: "days" });
  assert.deepEqual(frecuenciaMp("BIWEEKLY"), { frequency: 14, frequency_type: "days" });
});

test("ajuste: saldada / cancelada / caso cerrado → cancelar; monto distinto → monto; igual → nada", () => {
  const vivo = { estado: "authorized" as const, montoActual: 3000, casoCerrado: false };
  const igual = planDeCobro({ ...base, pagado: 9000, hoy: "2026-02-20" });
  assert.deepEqual(ajusteNecesario({ ...vivo, plan: igual }), { accion: "nada" });
  assert.equal(ajusteNecesario({ ...vivo, plan: planDeCobro({ ...base, pagado: 24000, hoy: "2026-02-20" }) }).accion, "cancelar");
  assert.equal(ajusteNecesario({ ...vivo, casoCerrado: true, plan: igual }).accion, "cancelar");
  // Descuento: la factura bajó a $21,000 → las mensualidades a $2,500.
  const conDescuento = planDeCobro({ ...base, total: 21000, pagado: 6000, hoy: "2026-01-20" });
  assert.deepEqual(ajusteNecesario({ ...vivo, plan: conDescuento }), { accion: "monto", monto: 2500 });
  // Ni la que se está creando ni la ya cancelada se tocan.
  assert.deepEqual(ajusteNecesario({ ...vivo, estado: "creating", plan: conDescuento }), { accion: "nada" });
  assert.deepEqual(ajusteNecesario({ ...vivo, estado: "cancelled", plan: conDescuento }), { accion: "nada" });
});

test("cuota que cubre un cobro: la más vieja que debía algo", () => {
  assert.deepEqual(cuotaQueCubre(PLAN, 24000, 9000, "2026-03-05"), { numero: 2, de: 6 });
  assert.equal(cuotaQueCubre(PLAN, 24000, 0, "2026-01-05"), null); // el enganche no es «mensualidad»
});

const cobro = (o: Partial<CobroMp>): CobroMp => ({
  id: "7001", preapprovalId: "pre1", status: "processed", paymentId: "9001", paymentStatus: "approved",
  paymentStatusDetail: "accredited", transactionAmount: 3000, currencyId: "MXN", debitDate: null, retryAttempt: 0, ...o,
});

test("decidir un cobro de MP", () => {
  assert.deepEqual(decidirCobro(cobro({}), "pre1"), { accion: "registrar", paymentId: "9001" });
  assert.deepEqual(decidirCobro(cobro({ status: "recycling", paymentStatus: "rejected", paymentStatusDetail: "cc_rejected_insufficient_amount" }), "pre1"),
    { accion: "rechazado", definitivo: false, detalle: "cc_rejected_insufficient_amount" });
  assert.equal((decidirCobro(cobro({ status: "processed", paymentStatus: "rejected" }), "pre1") as { definitivo: boolean }).definitivo, true);
  assert.equal(decidirCobro(cobro({ preapprovalId: "otra" }), "pre1").accion, "ignorar");
  assert.equal(decidirCobro(cobro({ currencyId: "ARS" }), "pre1").accion, "ignorar");
  assert.equal(decidirCobro(cobro({ status: "scheduled", paymentId: null, paymentStatus: null }), "pre1").accion, "esperar");
});

test("fechas para MP en la zona de la clínica", () => {
  assert.equal(desfaseDeZona("2026-03-05", "America/Mexico_City"), "-06:00");
  assert.equal(desfaseDeZona("2026-07-05", "America/Tijuana"), "-07:00");
  assert.equal(isoEnZona("2026-03-05", "10:00:00", "America/Mexico_City"), "2026-03-05T10:00:00.000-06:00");
  assert.equal(desfaseDeZona("2026-03-05", "Zona/Inexistente"), "-06:00");
});

test("ref, link y correo", () => {
  assert.equal(cobroDeRef(refDeCobro("abc-123")), "abc-123");
  assert.equal(cobroDeRef("factura:abc"), null);
  assert.equal(linkSeguro("https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=x"), "https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=x");
  assert.equal(linkSeguro("http://www.mercadopago.com.mx/x"), null);
  assert.equal(linkSeguro("https://mercadopago.com.mx.evil.test/x"), null);
  assert.equal(linkSeguro(null), null);
  assert.equal(correoValido("  Ana@Correo.MX "), "ana@correo.mx");
  assert.equal(correoValido("ana@"), null);
});
