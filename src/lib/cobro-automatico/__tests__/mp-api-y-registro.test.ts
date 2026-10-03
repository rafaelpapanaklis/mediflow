/**
 * Cobro automático con tarjeta (ws1-t6):
 *   1. el cliente REST de suscripciones con `fetch` SIMULADO — la URL, el método,
 *      las cabeceras y el cuerpo exactos que saldrían a Mercado Pago (los campos
 *      de la doc y del SDK oficial, ninguno inventado), y qué es transitorio;
 *   2. `registrarCobroEnFactura` sobre la base doble de factura-mp (candados de
 *      verdad): el mismo cobro dos veces A LA VEZ entra una sola vez.
 *
 * Ni red ni base. Run: npm run test:cobro-automatico
 */
import Module from "node:module";
import path from "node:path";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DobleBase } from "@/lib/factura-mp/__tests__/doble-base";

const RAIZ = path.resolve(__dirname, "../../../..");
const prohibido = new Proxy({}, { get: (_t, k) => { throw new Error(`prueba: nadie debe tocar la base real (prisma.${String(k)})`); } });
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown; _resolveFilename: (r: string, p: unknown, m: boolean) => string };
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let r: string | null = null;
  try { r = M._resolveFilename(req, parent, isMain); } catch { r = null; }
  if (r === path.join(RAIZ, "src/lib/prisma.ts")) return { prisma: prohibido };
  // Las condiciones de pago no se leen en estas pruebas.
  if (r === path.join(RAIZ, "src/lib/invoices/condiciones-pago-db.ts")) return { leerCondicionesDeFacturas: async () => ({ porFactura: new Map(), fallo: false, sinTabla: true }) };
  return cargaOriginal.call(this, req, parent, isMain);
};

const api = require("../mp-api") as typeof import("../mp-api");
const { registrarCobroEnFactura } = require("../factura.server") as typeof import("../factura.server");

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

function simularFetch(respuestas: Array<{ status: number; body: unknown }>) {
  const vistas: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    vistas.push({
      url: String(url),
      method: String(init.method),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = respuestas.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return vistas;
}

test("POST /preapproval: pendiente, en MXN, con exactamente los campos de la doc", async () => {
  const vistas = simularFetch([{ status: 201, body: {
    id: "2c9380847e9b451c017ea1bd70ba0219", status: "pending", external_reference: "cobroauto:x1", collector_id: 999,
    init_point: "https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=2c93", auto_recurring: { transaction_amount: 3000 },
  } }]);
  const sus = await api.crearSuscripcion("TOKEN-CLINICA", {
    reason: "Mensualidades · factura F-1", externalReference: "cobroauto:x1", payerEmail: "ana@prueba.test",
    backUrl: "https://app.test/pago/cobro-automatico",
    autoRecurring: { frequency: 1, frequency_type: "months", start_date: "2026-03-05T10:00:00.000-06:00", end_date: "2026-07-05T23:00:00.000-06:00", transaction_amount: 3000 },
  });
  assert.equal(vistas.length, 1);
  assert.equal(vistas[0].url, "https://api.mercadopago.com/preapproval");
  assert.equal(vistas[0].method, "POST");
  assert.equal(vistas[0].headers.Authorization, "Bearer TOKEN-CLINICA");
  assert.equal(vistas[0].headers["X-Idempotency-Key"], "cobroauto:x1");
  assert.deepEqual(vistas[0].body, {
    reason: "Mensualidades · factura F-1",
    external_reference: "cobroauto:x1",
    payer_email: "ana@prueba.test",
    auto_recurring: {
      frequency: 1, frequency_type: "months", start_date: "2026-03-05T10:00:00.000-06:00",
      end_date: "2026-07-05T23:00:00.000-06:00", transaction_amount: 3000, currency_id: "MXN",
    },
    back_url: "https://app.test/pago/cobro-automatico",
    status: "pending",
  });
  assert.equal(sus.id, "2c9380847e9b451c017ea1bd70ba0219");
  assert.equal(sus.collectorId, "999");
  assert.equal(sus.initPoint, "https://www.mercadopago.com.mx/subscriptions/checkout?preapproval_id=2c93");
});

test("PUT /preapproval/{id}: solo lo que MP deja cambiar (status, transaction_amount + currency_id)", async () => {
  const vistas = simularFetch([{ status: 200, body: { id: "PRE1", status: "paused" } }, { status: 200, body: { id: "PRE1", status: "authorized" } }]);
  await api.actualizarSuscripcion("T", "PRE1", { status: "paused" });
  await api.actualizarSuscripcion("T", "PRE1", { monto: 2500 });
  assert.equal(vistas[0].url, "https://api.mercadopago.com/preapproval/PRE1");
  assert.equal(vistas[0].method, "PUT");
  assert.deepEqual(vistas[0].body, { status: "paused" });
  assert.deepEqual(vistas[1].body, { auto_recurring: { transaction_amount: 2500, currency_id: "MXN" } });
});

test("GET /authorized_payments/{id} y la búsqueda por preapproval_id", async () => {
  const cobro = { id: 7001, preapproval_id: "PRE1", status: "processed", transaction_amount: 3000, currency_id: "MXN",
    retry_attempt: 0, debit_date: "2026-03-05", payment: { id: 9001, status: "approved", status_detail: "accredited" } };
  const vistas = simularFetch([{ status: 200, body: cobro }, { status: 200, body: { results: [cobro] } }]);
  const c = await api.consultarCobro("T", "7001");
  assert.equal(vistas[0].url, "https://api.mercadopago.com/authorized_payments/7001");
  assert.deepEqual(c, { id: "7001", preapprovalId: "PRE1", status: "processed", paymentId: "9001", paymentStatus: "approved",
    paymentStatusDetail: "accredited", transactionAmount: 3000, currencyId: "MXN", debitDate: "2026-03-05", retryAttempt: 0 });
  const lista = await api.buscarCobros("T", "PRE1");
  assert.equal(vistas[1].url, "https://api.mercadopago.com/authorized_payments/search?preapproval_id=PRE1&limit=50");
  assert.equal(lista.length, 1);
});

test("transitorio LANZA (5xx, 429, 401/403); un 404 en consulta es null; un 400 al crear es ErrorMp", async () => {
  for (const status of [500, 503, 429, 401, 403]) {
    simularFetch([{ status, body: {} }]);
    await assert.rejects(() => api.consultarCobro("T", "1"));
  }
  simularFetch([{ status: 404, body: {} }]);
  assert.equal(await api.consultarSuscripcion("T", "PRE1"), null);
  simularFetch([{ status: 400, body: { message: "Invalid payer_email" } }]);
  await assert.rejects(
    () => api.crearSuscripcion("T", { reason: "r", externalReference: "e", payerEmail: "x", backUrl: "b",
      autoRecurring: { frequency: 1, frequency_type: "months", start_date: "s", end_date: "e", transaction_amount: 1 } }),
    (e: unknown) => e instanceof api.ErrorMp && /Invalid payer_email/.test((e as Error).message),
  );
  // Un id con basura ni siquiera sale a la red.
  const vistas = simularFetch([]);
  assert.equal(await api.consultarCobro("T", "../payments/1"), null);
  assert.equal(vistas.length, 0);
});

/* ── registrarCobroEnFactura ─────────────────────────────────────────── */

function base(paid = 9000, status = "PARTIAL") {
  const b = new DobleBase();
  b.tablas.invoice.push({ id: "inv1", clinicId: "c1", total: 24000, paid, balance: 24000 - paid, status, invoiceNumber: "F-1", patientId: "p1" });
  return b;
}
const cobro = { clinicId: "c1", invoiceId: "inv1", monto: 3000, referencia: "PAY1", pagadoEl: new Date("2026-03-05T16:00:00Z"), nota: "Cobro automático con tarjeta (Mercado Pago)" };

test("registrar: el mismo cobro dos veces A LA VEZ entra UNA sola vez (FOR UPDATE de la factura)", async () => {
  const b = base();
  const [r1, r2] = await Promise.all([registrarCobroEnFactura(b.db(), cobro), registrarCobroEnFactura(b.db(), cobro)]);
  assert.equal([r1.aplicado, r2.aplicado].filter(Boolean).length, 1);
  assert.equal(b.tablas.payment.length, 1);
  assert.equal(b.tablas.invoice[0].paid, 12000);
  assert.equal(b.tablas.invoice[0].status, "PARTIAL");
  assert.equal(b.tablas.payment[0].method, "mercadopago");
  assert.equal(b.tablas.payment[0].reference, "PAY1");
  assert.ok(b.candadosPedidos.includes("invoices:inv1"));
});

test("control: sin el candado, el cobro doble SÍ entraría dos veces (la prueba de arriba no es de adorno)", async () => {
  const b = base();
  b.ignorarCandados = true;
  await Promise.all([registrarCobroEnFactura(b.db(), cobro), registrarCobroEnFactura(b.db(), cobro)]);
  assert.equal(b.tablas.payment.length, 2);
});

test("registrar: saldarla la deja PAID; de otra clínica no toca nada; sobre una saldada se marca para devolver", async () => {
  const b = base(21000);
  assert.equal((await registrarCobroEnFactura(b.db(), cobro)).aplicado, true);
  assert.equal(b.tablas.invoice[0].status, "PAID");
  assert.equal(b.tablas.invoice[0].balance, 0);

  const otra = base();
  assert.equal((await registrarCobroEnFactura(otra.db(), { ...cobro, clinicId: "c2" })).aplicado, false);
  assert.equal(otra.tablas.payment.length, 0);

  const saldada = base(24000, "PAID");
  const r = await registrarCobroEnFactura(saldada.db(), cobro);
  assert.equal(r.aplicado, true);
  assert.match(r.anomalia ?? "", /ya saldada/);
  assert.equal(saldada.tablas.invoice[0].paid, 24000, "la factura no cambia");
  assert.match(saldada.tablas.payment[0].notes, /^⚠️/);
});
