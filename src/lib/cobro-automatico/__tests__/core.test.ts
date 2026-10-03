/**
 * Cobro automático con tarjeta (ws1-t6) — la parte pura.
 *
 * Run: npm run test:cobro-automatico
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avisoDeCobroManual,
  decisionDeCiclo,
  hechoDeCobro,
  sumarDias,
  type CargoHecho,
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

/* ═══ F1 — el cobro doble (auditoría de dinero, 3-oct-2026) ═══════════════
 * Plan de 12 × $2,000 sin enganche, cargo de Mercado Pago los días 5,
 * del 5-oct-2026 al 5-sep-2027. */

const DOCE: CondicionesPago = { modo: "plazos", metodo: "credit", enganche: 0, numPagos: 12, frecuencia: "MONTHLY", primerPago: "2026-10-05", difiereConSuBanco: false };
const ciclo = (pagado: number, hoy: string, hechos: CargoHecho[] = []) =>
  decisionDeCiclo({ condiciones: DOCE, total: 24000, pagado, hoy, inicio: "2026-10-05", hechos });
const aviso = (pagado: number, monto: number, hoy: string, hechos: CargoHecho[] = []) =>
  avisoDeCobroManual({ condiciones: DOCE, total: 24000, pagado, monto, hoy, inicio: "2026-10-05", hechos, montoCargo: 2000, estado: "authorized", pausaManual: false });

test("F1 · el 3-oct se cobran $2,000 en caja → se pausa el cargo del 5-oct y vuelve el 6-oct para el del 5-nov", () => {
  assert.deepEqual(ciclo(0, "2026-10-03"), { estado: "authorized", saltados: [], reintentoHasta: null, reanudarEl: null, proximoCargo: "2026-10-05", cicloCobrado: null });
  assert.deepEqual(ciclo(2000, "2026-10-03"), { estado: "paused", saltados: ["2026-10-05"], reintentoHasta: null, reanudarEl: "2026-10-06", proximoCargo: "2026-11-05", cicloCobrado: null });
  // El 5-oct (MP no cobró: estaba pausada) sigue pausada; el 6-oct ya no hay nada que saltar.
  assert.equal(ciclo(2000, "2026-10-05").estado, "paused");
  assert.deepEqual(ciclo(2000, "2026-10-06"), { estado: "authorized", saltados: [], reintentoHasta: null, reanudarEl: null, proximoCargo: "2026-11-05", cicloCobrado: null });
  const a = aviso(0, 2000, "2026-10-03");
  assert.equal(a?.tipo, "pausa");
  assert.deepEqual(a?.saltados, ["2026-10-05"]);
  assert.equal(a?.reanudaPara, "2026-11-05");
  assert.equal(a?.requiereConfirmar, false);
});

test("F1 · abono parcial de $500 el 3-oct → NO se pausa: MP cobra sus $2,000 el 5-oct (lo de más va a noviembre)", () => {
  assert.equal(ciclo(500, "2026-10-03").estado, "authorized");
  const a = aviso(0, 500, "2026-10-03");
  assert.equal(a?.tipo, "sigue");
  assert.equal(a?.reanudaPara, "2026-10-05");
  assert.equal(a?.montoCargo, 2000, "el monto del cargo no cambia");
});

test("F1 · adelanto de 3 mensualidades ($6,000) el 3-oct → se saltan oct, nov y dic; vuelve el 6-dic para el 5-ene", () => {
  const d = ciclo(6000, "2026-10-03");
  assert.deepEqual(d.saltados, ["2026-10-05", "2026-11-05", "2026-12-05"]);
  assert.equal(d.reanudarEl, "2026-12-06");
  assert.equal(d.proximoCargo, "2027-01-05");
  assert.equal(aviso(0, 6000, "2026-10-03")?.tipo, "pausa");
});

test("F1 · liquidar todo ($24,000) → aviso «liquida» (el cobro automático se cancela)", () => {
  assert.deepEqual(aviso(0, 24000, "2026-10-03")?.tipo, "liquida");
  assert.deepEqual(aviso(4000, 20000, "2026-11-20", [{ fecha: "2026-10-05", hecho: "aprobado" }])?.tipo, "liquida");
});

test("F1 · caso inverso: MP cobró el 5-oct; el 6-oct recepción intenta cobrar $2,000 → hay que confirmar (sería un adelanto)", () => {
  const hechos: CargoHecho[] = [{ fecha: "2026-10-05T10:00:00.000-06:00", hecho: "aprobado" }];
  assert.equal(ciclo(2000, "2026-10-06", hechos).cicloCobrado, "2026-10-05");
  const a = aviso(2000, 2000, "2026-10-06", hechos);
  assert.equal(a?.tipo, "ya_cobrado");
  assert.equal(a?.requiereConfirmar, true);
  assert.deepEqual(a?.saltados, ["2026-11-05"], "si se confirma, se salta el de noviembre (ya pagado)");
  assert.equal(a?.reanudaPara, "2026-12-05");
  // Sin pagar nada de más, un cobro manual el 6-oct NO pausa nada: MP ya cobró octubre y noviembre aún debe.
  assert.equal(ciclo(2000, "2026-10-06", hechos).estado, "authorized");
});

test("F1 · el mismo día del cargo, si MP ya cobró, ese cargo no se vuelve a «saltar»", () => {
  const hechos: CargoHecho[] = [{ fecha: "2026-10-05", hecho: "aprobado" }];
  // Pagó en caja octubre a las 12:00 y MP ya había cobrado a las 10:00: lo de caja paga noviembre.
  const d = ciclo(4000, "2026-10-05", hechos);
  assert.deepEqual(d.saltados, ["2026-11-05"]);
  assert.equal(d.reanudarEl, "2026-11-06");
});

test("F1 · si el paciente va atrasado, lo cobrado en caja paga lo vencido y el cargo del día 5 sigue", () => {
  // Plan que empezó el 5-sep; septiembre sin pagar; el 3-oct paga $2,000 → cubre septiembre.
  const SEP = { ...DOCE, primerPago: "2026-09-05" };
  const d = decisionDeCiclo({ condiciones: SEP, total: 24000, pagado: 2000, hoy: "2026-10-03", inicio: "2026-10-05", hechos: [] });
  assert.equal(d.estado, "authorized");
  assert.equal(d.proximoCargo, "2026-10-05");
  // Y el aviso no pide confirmar (no es un cobro doble).
  const a = avisoDeCobroManual({ condiciones: SEP, total: 24000, pagado: 0, monto: 2000, hoy: "2026-10-03", inicio: "2026-10-05", hechos: [], montoCargo: 2000, estado: "authorized", pausaManual: false });
  assert.equal(a?.tipo, "sigue");
  assert.equal(a?.requiereConfirmar, false);
});

test("F1 · MP rechazó el 5-oct y lo reintenta; el 7-oct se cobra en caja → pausa hasta que cierre la ventana (16-oct)", () => {
  const hechos: CargoHecho[] = [{ fecha: "2026-10-05", hecho: "reintenta" }];
  const d = ciclo(2000, "2026-10-07", hechos);
  assert.equal(d.reintentoHasta, "2026-10-16");
  assert.equal(d.reanudarEl, "2026-10-16");
  assert.equal(d.estado, "paused");
  assert.equal(aviso(0, 2000, "2026-10-07", hechos)?.tipo, "reintento");
  // El 16-oct ya no: se reanuda para el 5-nov.
  assert.equal(ciclo(2000, "2026-10-16", hechos).estado, "authorized");
  // Un rechazo final (MP ya no reintenta) no pausa nada.
  assert.equal(ciclo(2000, "2026-10-07", [{ fecha: "2026-10-05", hecho: "rechazado" }]).estado, "authorized");
});

test("F1 · una pausa manual o una suscripción pendiente no avisan; los hechos de MP se leen bien", () => {
  assert.equal(avisoDeCobroManual({ condiciones: DOCE, total: 24000, pagado: 0, monto: 2000, hoy: "2026-10-03", inicio: "2026-10-05", hechos: [], montoCargo: 2000, estado: "paused", pausaManual: true }), null);
  assert.equal(avisoDeCobroManual({ condiciones: DOCE, total: 24000, pagado: 0, monto: 2000, hoy: "2026-10-03", inicio: "2026-10-05", hechos: [], montoCargo: 2000, estado: "pending", pausaManual: false }), null);
  assert.equal(hechoDeCobro({ status: "scheduled", paymentStatus: null }), null, "programado no es hecho: MP aún lo cobrará");
  assert.equal(hechoDeCobro({ status: "processed", paymentStatus: "approved" }), "aprobado");
  assert.equal(hechoDeCobro({ status: "recycling", paymentStatus: "rejected" }), "reintenta");
  assert.equal(hechoDeCobro({ status: "processed", paymentStatus: "rejected" }), "rechazado");
  assert.equal(sumarDias("2026-12-31", 1), "2027-01-01");
});
