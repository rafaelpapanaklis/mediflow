/**
 * ws1-t3 · Cancelación de CFDI ante el SAT, sincronía y nota de crédito
 * (auditoría CFDI F-02, F-03, F-16 parte egreso).
 *
 * Run: npm run test:cfdi-cancelacion
 *
 * ⛔ No se timbra ni se cancela nada: `fetch` está sustituido por un doble y la
 * orquestación recibe sus dependencias dobladas. Ni una llamada sale del proceso.
 */
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";

// facturapi.ts y la orquestación arrastran Prisma al importarse; aquí no hay base.
// Por eso los módulos se cargan con require DESPUÉS del doble (CJS, sin await de primer nivel).
/* eslint-disable @typescript-eslint/no-require-imports */
(mock as any).module("@/lib/prisma", { namedExports: { prisma: {} } });

const {
  efectoDeEstado, soltarFacturaAlCancelar, prediccionAceptacion, validarCancelacion,
  validarSustitucion, efectoNotaEnFactura, conceptoNotaDeCredito, usoParaEgreso,
  disponibleParaNota, validarNotaCredito, modoIvaDeConceptos, fueraDePlazoDeCancelacion,
  CLAVE_SAT_EGRESO, UNIDAD_SAT_EGRESO, sigueVigente,
} = require("@/lib/invoices/cfdi-cancelacion") as typeof import("@/lib/invoices/cfdi-cancelacion");
const { urlCancelacion, cancelInvoice, createInvoice } = require("@/lib/facturapi") as typeof import("@/lib/facturapi");
const { pudoHaberTimbrado } = require("@/lib/invoices/cfdi-timbre-incierto") as typeof import("@/lib/invoices/cfdi-timbre-incierto");
const { pedirCancelacion, sincronizarCfdi } = require("@/lib/invoices/cfdi-cancelacion.server") as typeof import("@/lib/invoices/cfdi-cancelacion.server");
const { firmaValida, secretosDeWebhook, idDelEvento } = require("@/lib/invoices/facturapi-webhook") as typeof import("@/lib/invoices/facturapi-webhook");
const { estadoPintado, accionesDe } = require("@/components/dashboard/billing/cfdi-ante-el-sat-core") as typeof import("@/components/dashboard/billing/cfdi-ante-el-sat-core");

// ═══════════════════════════════════════════════════════════════════════════
// 1 · facturapi.ts: el motivo va en la QUERY (F-02)
// ═══════════════════════════════════════════════════════════════════════════

type Llamada = { url: string; init: RequestInit | undefined };
let llamadas: Llamada[] = [];
let respuesta: () => Promise<Response> = async () => new Response("{}", { status: 200 });
const fetchOriginal = globalThis.fetch;

beforeEach(() => {
  llamadas = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    llamadas.push({ url: String(url), init });
    return respuesta();
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = fetchOriginal; });

const json = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("motivo 02 → DELETE …/invoices/{id}?motive=02 y SIN cuerpo (antes iba en el cuerpo)", async () => {
  respuesta = json(200, { id: "fa_1", uuid: "U-1", status: "canceled", cancellation_status: "accepted" });
  const r = await cancelInvoice("sk_x", "fa_1", "02");
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, "https://www.facturapi.io/v2/invoices/fa_1?motive=02");
  assert.equal(llamadas[0].init?.method, "DELETE");
  assert.equal(llamadas[0].init?.body, undefined);
  assert.equal(r.status, "canceled");
  assert.equal(r.cancellationStatus, "accepted");
});

test("motivo 01 → lleva substitution con el UUID del sustituto", () => {
  assert.equal(
    urlCancelacion("fa_1", "01", "AAAA-BBBB"),
    "https://www.facturapi.io/v2/invoices/fa_1?motive=01&substitution=AAAA-BBBB",
  );
});

test("respuesta pending → se devuelve tal cual (el CFDI sigue vigente)", async () => {
  respuesta = json(200, { id: "fa_1", status: "valid", cancellation_status: "pending" });
  const r = await cancelInvoice("sk_x", "fa_1", "02");
  assert.equal(r.status, "valid");
  assert.equal(r.cancellationStatus, "pending");
});

test("4xx = rechazo claro; 5xx y red = «no se sabe si llegó al SAT»", async () => {
  respuesta = json(400, { message: "El CFDI no se puede cancelar" });
  await assert.rejects(cancelInvoice("sk", "fa", "02"), (e: any) => !pudoHaberTimbrado(e) && /no se puede cancelar/.test(e.message));
  respuesta = json(502, {});
  await assert.rejects(cancelInvoice("sk", "fa", "02"), (e: any) => pudoHaberTimbrado(e));
  respuesta = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(cancelInvoice("sk", "fa", "02"), (e: any) => pudoHaberTimbrado(e));
});

test("createInvoice de egreso: type E y related_documents 01 al UUID original", async () => {
  respuesta = json(200, { id: "fa_e", uuid: "U-E", total: 500 });
  await createInvoice({
    orgApiKey: "sk", customerId: "cus_1", usoCfdi: "G02", paymentForm: "03",
    items: [conceptoNotaDeCredito({ monto: 500, modoIva: "exento", descripcion: "Devolución" }) as any],
    tipo: "E", relatedDocuments: [{ relationship: "01", documents: ["UUID-ORIG"] }], exigirUuid: true,
  });
  const body = JSON.parse(String(llamadas[0].init?.body));
  assert.equal(body.type, "E");
  assert.deepEqual(body.related_documents, [{ relationship: "01", documents: ["UUID-ORIG"] }]);
  assert.equal(body.items[0].product.product_key, "84111506");
  assert.equal(body.items[0].product.unit_key, "ACT");
  assert.equal(body.items[0].product.price, 500);
});

test("createInvoice sin tipo ni relacionados: el payload de siempre (I, sin related_documents)", async () => {
  respuesta = json(200, { id: "fa_i", uuid: "U-I", total: 100 });
  await createInvoice({ orgApiKey: "sk", customerId: "c", usoCfdi: "D01", items: [] });
  const body = JSON.parse(String(llamadas[0].init?.body));
  assert.equal(body.type, "I");
  assert.equal("related_documents" in body, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Estados y efecto en la factura
// ═══════════════════════════════════════════════════════════════════════════

test("efectoDeEstado: solo canceled/accepted pasa a «cancelled»; pending sigue vigente", () => {
  assert.deepEqual(efectoDeEstado({ status: "canceled", cancellationStatus: "accepted" }), { status: "cancelled", cancellationStatus: "accepted" });
  assert.deepEqual(efectoDeEstado({ status: "valid", cancellationStatus: "pending" }), { status: "valid", cancellationStatus: "pending" });
  assert.deepEqual(efectoDeEstado({ status: "valid", cancellationStatus: "verifying" }), { status: "valid", cancellationStatus: "verifying" });
  assert.deepEqual(efectoDeEstado({ status: "valid", cancellationStatus: "rejected" }), { status: "valid", cancellationStatus: "rejected" });
  assert.deepEqual(efectoDeEstado({ status: "valid", cancellationStatus: "none" }), { status: "valid", cancellationStatus: "none" });
});

test("soltar la factura: solo el ingreso completo al que todavía apunta", () => {
  const base = { tipoComprobante: "I", paymentId: null, uuid: "U1", invoiceCfdiUuid: "U1" };
  assert.equal(soltarFacturaAlCancelar(base), true);
  assert.equal(soltarFacturaAlCancelar({ ...base, invoiceCfdiUuid: "U2" }), false, "con 01 apunta al sustituto");
  assert.equal(soltarFacturaAlCancelar({ ...base, paymentId: "pay_1" }), false, "CFDI por pago");
  assert.equal(soltarFacturaAlCancelar({ ...base, tipoComprobante: "E" }), false, "nota de crédito");
  assert.equal(sigueVigente("sustituido"), true);
  assert.equal(sigueVigente("cancelled"), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · ¿Pide aceptación del receptor? (regla 2.7.1.34)
// ═══════════════════════════════════════════════════════════════════════════

// Viernes 2-oct-2026, 12:00 en CDMX (18:00 UTC).
const VIERNES = new Date("2026-10-02T18:00:00Z");

test("$1,600 a persona física, cancelado el martes siguiente → pide aceptación (caso BEVADENT)", () => {
  const r = prediccionAceptacion({ total: 1600, tipoComprobante: "I", receptorRfc: "XAXX9901011A1", emitidoEn: VIERNES, ahora: new Date("2026-10-06T17:00:00Z") });
  assert.deepEqual(r, { requiere: true, razon: null });
});

test("el día hábil siguiente salta el fin de semana: viernes → lunes no pide aceptación", () => {
  const lunes = new Date("2026-10-05T23:00:00Z"); // lunes 17:00 CDMX
  assert.deepEqual(prediccionAceptacion({ total: 1600, tipoComprobante: "I", receptorRfc: "AAAA010101AA1", emitidoEn: VIERNES, ahora: lunes }), { requiere: false, razon: "plazo" });
});

test("hasta $1,000, egreso y público en general no piden aceptación", () => {
  const tarde = new Date("2026-11-20T18:00:00Z");
  assert.equal(prediccionAceptacion({ total: 1000, tipoComprobante: "I", receptorRfc: "AAAA010101AA1", emitidoEn: VIERNES, ahora: tarde }).razon, "monto");
  assert.equal(prediccionAceptacion({ total: 1000.01, tipoComprobante: "I", receptorRfc: "AAAA010101AA1", emitidoEn: VIERNES, ahora: tarde }).requiere, true);
  assert.equal(prediccionAceptacion({ total: 5000, tipoComprobante: "E", receptorRfc: "AAAA010101AA1", emitidoEn: VIERNES, ahora: tarde }).razon, "egreso");
  assert.equal(prediccionAceptacion({ total: 5000, tipoComprobante: "I", receptorRfc: "xaxx010101000", emitidoEn: VIERNES, ahora: tarde }).razon, "publicoGeneral");
});

test("plazo de la declaración anual: un CFDI de 2026 ya no se cancela en abril de 2027", () => {
  assert.equal(fueraDePlazoDeCancelacion(VIERNES, new Date("2027-03-15T18:00:00Z")), false);
  assert.equal(fueraDePlazoDeCancelacion(VIERNES, new Date("2027-04-02T18:00:00Z")), true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Validar la solicitud
// ═══════════════════════════════════════════════════════════════════════════

const CFDI = {
  id: "c1", uuid: "U-1", status: "valid", tipoComprobante: "I", invoiceId: "inv1", total: 1600,
  receptorRfc: "AAAA010101AA1", cancellationStatus: null, cancelRequestedAt: null,
} as const;
const AHORA = new Date("2026-10-06T17:00:00Z");
const val = (over: Record<string, unknown> = {}) => validarCancelacion({
  motive: "02", reason: "forma de pago equivocada", cfdi: { ...CFDI } as any, sustituto: null, egresosVigentes: 0, ahora: AHORA, ...over,
} as any);

test("motivo 01 sin sustituto → FALTA_SUSTITUTO (antes de llamar a nadie)", () => {
  assert.equal(val({ motive: "01" }), "FALTA_SUSTITUTO");
});

test("motivo 01 con sustituto bien relacionado pasa; mal relacionado no", () => {
  const sust = { id: "c2", uuid: "U-2", status: "valid", tipoComprobante: "I", invoiceId: "inv1", relatedUuid: "U-1", relationType: "04" };
  assert.equal(val({ motive: "01", sustituto: sust, cfdi: { ...CFDI, status: "sustituido" } }), null);
  assert.equal(val({ motive: "01", sustituto: { ...sust, relatedUuid: "OTRO" } }), "SUSTITUTO_INVALIDO");
  assert.equal(val({ motive: "01", sustituto: { ...sust, invoiceId: "inv9" } }), "SUSTITUTO_INVALIDO");
});

test("sin motivo, sin razón, cancelado, en curso, 04 fuera de global, con notas de crédito", () => {
  assert.equal(val({ motive: "05" }), "MOTIVO_INVALIDO");
  assert.equal(val({ reason: "x" }), "RAZON_CORTA");
  assert.equal(val({ cfdi: { ...CFDI, status: "cancelled" } }), "NO_VIGENTE");
  assert.equal(val({ cfdi: { ...CFDI, cancellationStatus: "pending" } }), "EN_CURSO");
  assert.equal(val({ cfdi: { ...CFDI, cancellationStatus: "incierto" } }), "EN_CURSO");
  assert.equal(val({ motive: "04" }), "MOTIVO_04_SOLO_GLOBAL");
  assert.equal(val({ motive: "04", cfdi: { ...CFDI, receptorRfc: "XAXX010101000" } }), null);
  assert.equal(val({ egresosVigentes: 1 }), "TIENE_EGRESOS_VIGENTES");
});

test("una reserva «enviando» de hace más de 10 min se puede retomar; una reciente no", () => {
  assert.equal(val({ cfdi: { ...CFDI, cancellationStatus: "enviando", cancelRequestedAt: new Date(AHORA.getTime() - 11 * 60_000) } }), null);
  assert.equal(val({ cfdi: { ...CFDI, cancellationStatus: "enviando", cancelRequestedAt: new Date(AHORA.getTime() - 2 * 60_000) } }), "EN_CURSO");
});

test("sustituir: solo el ingreso completo vigente al que apunta la factura", () => {
  const viejo = { uuid: "U-1", status: "valid", invoiceId: "inv1", paymentId: null, tipoComprobante: "I", cancellationStatus: null };
  assert.equal(validarSustitucion({ invoiceId: "inv1", invoiceCfdiUuid: "U-1", viejo }), null);
  assert.equal(validarSustitucion({ invoiceId: "inv1", invoiceCfdiUuid: "U-9", viejo }), "NO_ES_DE_ESTA_FACTURA");
  assert.equal(validarSustitucion({ invoiceId: "inv1", invoiceCfdiUuid: "U-1", viejo: { ...viejo, paymentId: "p" } }), "POR_PAGO");
  assert.equal(validarSustitucion({ invoiceId: "inv1", invoiceCfdiUuid: "U-1", viejo: { ...viejo, cancellationStatus: "pending" } }), "EN_CURSO");
  assert.equal(validarSustitucion({ invoiceId: "inv1", invoiceCfdiUuid: "U-1", viejo: null }), "NO_ES_DE_ESTA_FACTURA");
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · La orquestación (dependencias dobladas)
// ═══════════════════════════════════════════════════════════════════════════

function fila(over: Record<string, unknown> = {}) {
  return {
    id: "c1", clinicId: "cli1", invoiceId: "inv1", paymentId: null, facturapiId: "fa_1", uuid: "U-1",
    tipoComprobante: "I", receptor: { rfc: "AAAA010101AA1" }, conceptos: [], total: 1600, status: "valid",
    cancelledAt: null, createdAt: VIERNES, cancellationStatus: null, cancelMotive: null, cancelReason: null,
    cancelRequestedAt: null, cancelRequestedBy: null, substitutedByUuid: null, relatedUuid: null,
    relationType: null, refundPaymentId: null, satCheckedAt: null, ...over,
  } as any;
}

function dobles(estadoCancel: { status: string; cancellationStatus: string } | Error, over: Record<string, any> = {}) {
  const reg = { cancelar: [] as any[], aplicar: [] as any[], incierta: 0, soltada: 0, llave: 0 };
  const deps = {
    columnas: async () => ({ cancelacion: true, pago: true, at: 0 }),
    leerCfdi: async (_db: any, a: any) => (a.cfdiId === "c1" ? fila() : null),
    egresosVigentesDe: async () => [],
    reservar: async () => true,
    soltarReserva: async () => { reg.soltada += 1; },
    marcarIncierta: async () => { reg.incierta += 1; },
    aplicarEstado: async (a: any) => { reg.aplicar.push(a); return { recienCancelado: a.efecto.status === "cancelled", facturaLiberada: a.efecto.status === "cancelled" && a.soltarFactura }; },
    marcarRevisado: async () => undefined,
    llave: async () => { reg.llave += 1; return { key: "sk_live", ambiente: "live" as const, estado: { id: "fa_1", uuid: "U-1", status: "valid", cancellationStatus: "none", total: 1600, customerId: "cus", paymentForm: "04", use: "D01" } }; },
    cancelar: async (...args: any[]) => { reg.cancelar.push(args); if (estadoCancel instanceof Error) throw estadoCancel; return { id: "fa_1", uuid: "U-1", total: 1600, customerId: null, paymentForm: null, use: null, ...estadoCancel }; },
    orgDeClinica: async () => ({ orgId: "org_1", timezone: "America/Mexico_City" }),
    cfdiUuidDeFactura: async () => ({ cfdiUuid: "U-1", patientId: "pac1", invoiceNumber: "F-000231" }),
    ahora: () => AHORA,
    ...over,
  };
  return { reg, deps };
}

const PEDIR = { clinicId: "cli1", userId: "u1", cfdiId: "c1", motive: "02", reason: "forma de pago equivocada" };

test("02 con respuesta pending → 200, el CFDI sigue vigente y la factura NO se suelta", async () => {
  const { reg, deps } = dobles({ status: "valid", cancellationStatus: "pending" });
  const r = await pedirCancelacion(PEDIR, deps as any);
  assert.equal(r.status, 200);
  assert.deepEqual(reg.cancelar[0], ["sk_live", "fa_1", "02", null]);
  assert.deepEqual(reg.aplicar[0].efecto, { status: "valid", cancellationStatus: "pending" });
  assert.equal(r.body.resultado!.facturaLiberada, false);
});

test("02 con respuesta accepted → cancelled y la factura se suelta (vuelve a poder timbrarse)", async () => {
  const { reg, deps } = dobles({ status: "canceled", cancellationStatus: "accepted" });
  const r = await pedirCancelacion(PEDIR, deps as any);
  assert.equal(r.status, 200);
  assert.deepEqual(reg.aplicar[0].efecto, { status: "cancelled", cancellationStatus: "accepted" });
  assert.equal(reg.aplicar[0].soltarFactura, true);
  assert.equal(r.body.resultado!.facturaLiberada, true);
});

test("01 sin sustituto → 400 sin hablar con Facturapi ni reservar", async () => {
  const { reg, deps } = dobles({ status: "canceled", cancellationStatus: "accepted" });
  const r = await pedirCancelacion({ ...PEDIR, motive: "01" }, deps as any);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "FALTA_SUSTITUTO");
  assert.equal(reg.llave, 0);
  assert.equal(reg.cancelar.length, 0);
});

test("se cortó la red al cancelar → «incierta», 502, la reserva NO se suelta", async () => {
  const { reg, deps } = dobles(Object.assign(new TypeError("fetch failed")));
  const r = await pedirCancelacion(PEDIR, deps as any);
  assert.equal(r.status, 502);
  assert.equal(r.body.code, "CANCELACION_INCIERTA");
  assert.equal(reg.incierta, 1);
  assert.equal(reg.soltada, 0);
});

test("Facturapi la rechaza (4xx) → 422 y la reserva se suelta para reintentar", async () => {
  const { marcarTimbre } = require("@/lib/invoices/cfdi-timbre-incierto") as typeof import("@/lib/invoices/cfdi-timbre-incierto");
  const { reg, deps } = dobles(marcarTimbre(new Error("El CFDI ya fue cancelado previamente"), false));
  const r = await pedirCancelacion(PEDIR, deps as any);
  assert.equal(r.status, 422);
  assert.equal(reg.soltada, 1);
  assert.equal(reg.incierta, 0);
});

test("dos pestañas: la que no consigue la reserva recibe 409 y no cancela", async () => {
  const { reg, deps } = dobles({ status: "canceled", cancellationStatus: "accepted" }, { reservar: async () => false });
  const r = await pedirCancelacion(PEDIR, deps as any);
  assert.equal(r.status, 409);
  assert.equal(reg.cancelar.length, 0);
});

test("ya cancelado desde el dashboard de Facturapi → no se manda otra cancelación; se sincroniza", async () => {
  const { reg, deps } = dobles({ status: "canceled", cancellationStatus: "accepted" }, {
    llave: async () => ({ key: "sk", ambiente: "live", estado: { id: "fa_1", uuid: "U-1", status: "canceled", cancellationStatus: "accepted", total: 1600, customerId: null, paymentForm: null, use: null } }),
  });
  const r = await pedirCancelacion(PEDIR, deps as any);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "YA_CANCELADO_FUERA");
  assert.equal(reg.cancelar.length, 0);
  assert.equal(reg.aplicar[0].efecto.status, "cancelled");
});

test("sin el SQL pegado → 503 con el nombre del archivo", async () => {
  const { deps } = dobles({ status: "canceled", cancellationStatus: "accepted" }, { columnas: async () => ({ cancelacion: false, pago: false, at: 0 }) });
  const r = await pedirCancelacion(PEDIR, deps as any);
  assert.equal(r.status, 503);
  assert.match(String(r.body.error), /ws1-t3-cfdi-cancelacion\.sql/);
});

test("sincronizar (webhook/cron/botón): cancelado en Facturapi → cfdi cancelado y factura libre", async () => {
  const { reg, deps } = dobles({ status: "valid", cancellationStatus: "none" }, {
    llave: async () => ({ key: "sk", ambiente: "live", estado: { id: "fa_1", uuid: "U-1", status: "canceled", cancellationStatus: "accepted", total: 1600, customerId: null, paymentForm: null, use: null } }),
  });
  const r = await sincronizarCfdi(fila(), deps as any);
  assert.equal(r.recienCancelado, true);
  assert.equal(r.facturaLiberada, true);
  assert.equal(reg.cancelar.length, 0, "sincronizar nunca cancela");
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Nota de crédito (egreso, relación 01) — los números de la auditoría
// ═══════════════════════════════════════════════════════════════════════════

const FACT_1600 = { status: "PAID", subtotal: 1600, discount: 0, total: 1600, paid: 1600, balance: 0, taxRate: 0, taxIncluded: true };

test("devolución de $500 de una factura timbrada de $1,600 → la factura queda en $1,100 neto, pagada", () => {
  const e = efectoNotaEnFactura(FACT_1600, 500, true);
  assert.deepEqual(e, { ok: true, total: 1100, discount: 500, paid: 1100, balance: 0, status: "PAID" });
});

test("con IVA agregado: devolver $580 quita $500 de base del descuento", () => {
  const f = { status: "PAID", subtotal: 1000, discount: 0, total: 1160, paid: 1160, balance: 0, taxRate: 16, taxIncluded: false };
  const e = efectoNotaEnFactura(f, 580, true) as any;
  assert.equal(e.total, 580);
  assert.equal(e.discount, 500);
  assert.equal(e.paid, 580);
  assert.equal(e.balance, 0);
});

test("bonificación sin devolver dinero: baja total y saldo; no puede pasar del saldo", () => {
  const f = { status: "PARTIAL", subtotal: 2000, discount: 0, total: 2000, paid: 1500, balance: 500, taxRate: 0, taxIncluded: true };
  assert.deepEqual(efectoNotaEnFactura(f, 300, false), { ok: true, total: 1700, discount: 300, paid: 1500, balance: 200, status: "PARTIAL" });
  assert.deepEqual(efectoNotaEnFactura(f, 600, false), { ok: false, error: "EXCEDE_SALDO" });
  assert.deepEqual(efectoNotaEnFactura(f, 1600, true), { ok: false, error: "EXCEDE_PAGADO" });
});

test("disponible: $1,600 con una nota de $500 → $1,100; una de $1,200 ya no cabe", () => {
  assert.equal(disponibleParaNota(1600, [500]), 1100);
  const v = validarNotaCredito({
    monto: 1200, razon: "devolución", cfdi: { status: "valid", tipoComprobante: "I", total: 1600, cancellationStatus: null },
    egresosVigentes: [500], factura: { ...FACT_1600, paid: 1100, total: 1100 }, devolverDinero: true,
  });
  assert.equal(v, "EXCEDE_CFDI");
  assert.equal(validarNotaCredito({
    monto: 500, razon: "devolución", cfdi: { status: "valid", tipoComprobante: "E", total: 1600, cancellationStatus: null },
    egresosVigentes: [], factura: FACT_1600, devolverDinero: true,
  }), "NO_ES_INGRESO");
});

test("concepto del egreso: mismo IVA que el original, clave 84111506 / ACT", () => {
  const ex = conceptoNotaDeCredito({ monto: 500, modoIva: "exento", descripcion: "Devolución" });
  assert.equal(ex.product.product_key, CLAVE_SAT_EGRESO);
  assert.equal(ex.product.unit_key, UNIDAD_SAT_EGRESO);
  assert.equal(ex.product.tax_included, false);
  assert.deepEqual(ex.product.taxes, [{ type: "IVA", factor: "Exento", rate: 0 }]);
  const iva = conceptoNotaDeCredito({ monto: 580, modoIva: "iva16", descripcion: "Devolución" });
  assert.equal(iva.product.tax_included, true, "el total del egreso es exactamente el monto");
  assert.equal(modoIvaDeConceptos([{ product: { taxes: [{ type: "IVA", factor: "Exento", rate: 0 }] } }]), "exento");
  assert.equal(modoIvaDeConceptos([{ product: { taxes: [{ type: "IVA", rate: 0.16 }] } }]), "iva16");
});

test("uso del egreso: G02 si el régimen lo admite; si no, el del CFDI original", () => {
  assert.equal(usoParaEgreso("612", "D01"), "G02");
  assert.equal(usoParaEgreso("626", "G03"), "G02");
  assert.equal(usoParaEgreso("605", "D01"), "D01");
  assert.equal(usoParaEgreso("605", null), "S01");
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · Webhook: firma
// ═══════════════════════════════════════════════════════════════════════════

test("firma HMAC-SHA256 hex del cuerpo crudo; varios secretos; basura no pasa", () => {
  const cuerpo = JSON.stringify({ type: "invoice.cancellation_status_updated", data: { object: { id: "fa_1" } } });
  const firma = createHmac("sha256", "whsec_b").update(cuerpo).digest("hex");
  assert.equal(firmaValida(cuerpo, firma, ["whsec_a", "whsec_b"]), true);
  assert.equal(firmaValida(cuerpo, firma, ["whsec_a"]), false);
  assert.equal(firmaValida(cuerpo + " ", firma, ["whsec_b"]), false, "un byte distinto");
  assert.equal(firmaValida(cuerpo, "zz", ["whsec_b"]), false);
  assert.equal(firmaValida(cuerpo, null, ["whsec_b"]), false);
  assert.deepEqual(secretosDeWebhook(" a , b,,"), ["a", "b"]);
  assert.equal(idDelEvento(JSON.parse(cuerpo)), "fa_1");
  assert.equal(idDelEvento({ type: "receipt.status_updated", data: { object: { id: "x" } } }), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · La pantalla: qué botones salen
// ═══════════════════════════════════════════════════════════════════════════

function vista(over: Record<string, unknown> = {}) {
  return {
    id: "c1", uuid: "U-1", tipoComprobante: "I", total: 1600, status: "valid", paymentId: null,
    createdAt: VIERNES.toISOString(), cancelledAt: null, cancellationStatus: null, cancelMotive: null,
    cancelReason: null, substitutedByUuid: null, relatedUuid: null, relationType: null, refundPaymentId: null,
    satCheckedAt: null, receptorRfc: "AAAA010101AA1", aceptacion: { requiere: true, razon: null }, fueraDePlazo: false,
    ...over,
  } as any;
}
const CTX = { listo: true, admin: true, invoiceCfdiUuid: "U-1" };

test("vigente, admin y SQL pegado → consultar, cancelar, sustituir y nota de crédito", () => {
  const a = accionesDe(vista(), [vista()], CTX);
  assert.deepEqual(a, { consultar: true, cancelar: true, cancelarSustituido: false, sustituir: true, notaCredito: true });
});

test("sin SQL o sin ser admin → solo consultar", () => {
  assert.deepEqual(accionesDe(vista(), [vista()], { ...CTX, listo: false }), { consultar: true, cancelar: false, cancelarSustituido: false, sustituir: false, notaCredito: false });
  assert.deepEqual(accionesDe(vista(), [vista()], { ...CTX, admin: false }), { consultar: true, cancelar: false, cancelarSustituido: false, sustituir: false, notaCredito: false });
});

test("sustituido con su sustituto → «Cancelar el anterior (motivo 01)»; pendiente → nada más que consultar", () => {
  const viejo = vista({ status: "sustituido" });
  const nuevo = vista({ id: "c2", uuid: "U-2", relationType: "04", relatedUuid: "U-1" });
  const a = accionesDe(viejo, [viejo, nuevo], { ...CTX, invoiceCfdiUuid: "U-2" });
  assert.equal(a.cancelarSustituido, true);
  assert.equal(a.cancelar, false);
  assert.equal(estadoPintado(viejo), "sustituido");
  const pend = vista({ cancellationStatus: "pending" });
  assert.deepEqual(accionesDe(pend, [pend], CTX), { consultar: true, cancelar: false, cancelarSustituido: false, sustituir: false, notaCredito: false });
  assert.equal(estadoPintado(pend), "pendiente");
});

test("con una nota de crédito vigente el ingreso no se puede cancelar ni sustituir", () => {
  const ing = vista();
  const nota = vista({ id: "c3", uuid: "U-3", tipoComprobante: "E", relationType: "01", relatedUuid: "U-1", total: 500 });
  const a = accionesDe(ing, [ing, nota], CTX);
  assert.equal(a.cancelar, false);
  assert.equal(a.sustituir, false);
  assert.equal(a.notaCredito, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// Auditoría de uso (ws1-t4, 4-oct-2026) · C-42: motivo 03 con dinero cobrado
// ═══════════════════════════════════════════════════════════════════════════

test("C-42 · motivo 03 en una factura cobrada ($3,000, MF-1080) → MOTIVO_03_CON_COBRO; sin cobro o devuelta, pasa", () => {
  assert.equal(val({ motive: "03", cobrado: 3000 }), "MOTIVO_03_CON_COBRO");
  assert.equal(val({ motive: "03", cobrado: 0 }), null, "devuelta (pagado neto $0): sí es 03");
  assert.equal(val({ motive: "03" }), null, "sin dato no se bloquea por esto");
  assert.equal(val({ motive: "02", cobrado: 3000 }), null, "02 sí se puede (y reemitir)");
  // Una nota de crédito (egreso) no es «la operación»: el candado es solo para ingresos.
  assert.equal(val({ motive: "03", cobrado: 3000, cfdi: { ...CFDI, tipoComprobante: "E" } }), null);
});

test("C-42 · el servidor lo corta antes de reservar o hablar con Facturapi", async () => {
  const { reg, deps } = dobles({ status: "canceled", cancellationStatus: "accepted" }, {
    cfdiUuidDeFactura: async () => ({ cfdiUuid: "U-1", patientId: "pac1", invoiceNumber: "MF-1080", paid: 3000 }),
  });
  const r = await pedirCancelacion({ ...PEDIR, motive: "03" }, deps as any);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "MOTIVO_03_CON_COBRO");
  assert.equal(reg.cancelar.length, 0);
  assert.equal(reg.llave, 0);
});
