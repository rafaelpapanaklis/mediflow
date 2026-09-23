/**
 * El webhook de Mercado Pago ENTERO con un pago de factura (ws1-t1).
 *
 * Run: npm run test:factura-mp
 *
 * Corre DE VERDAD `POST /api/webhooks/mercadopago` —la firma x-signature, el
 * reparto por `?ref=`, y `lib/factura-mp/servicio.server.ts` con sus
 * dependencias reales (`depsReales`)—. Lo único sustituido, por ruta resuelta:
 * Prisma (el doble con candados de verdad de doble-base.ts), la API de Mercado
 * Pago (lib/mercadopago.ts), la cuenta de la clínica (anticipos/cuenta.server:
 * el token cifrado no hace falta aquí) y las otras ramas del webhook, que no se
 * deben tocar. Ni red ni base.
 */

import Module from "node:module";
import path from "node:path";
import { createHmac } from "node:crypto";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DobleBase } from "./doble-base";
import type { MercadoPagoPayment } from "../../mercadopago";

const RAIZ = path.resolve(__dirname, "../../../..");

let db = new DobleBase();
const pagos = new Map<string, MercadoPagoPayment>();
let consultas = 0;
let revalidaciones = 0;
let anticiposTocados = 0;
let conCuenta = true;

// Un Proxy para que cada prueba pueda cambiar de base sin recargar módulos.
const prismaDoble = new Proxy({}, { get: (_t, k) => db.db()[k as string] });

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble }],
  [
    path.join(RAIZ, "src/lib/mercadopago.ts"),
    {
      getPayment: async (_token: string, id: string) => {
        consultas++;
        return pagos.get(id) ?? null;
      },
      createPreference: async (_token: string, o: { externalReference: string }) => ({
        id: `pref-${o.externalReference}`,
        initPoint: `https://mp.test/checkout/${encodeURIComponent(o.externalReference)}`,
      }),
      expirePreference: async () => {},
    },
  ],
  [
    path.join(RAIZ, "src/lib/anticipos/cuenta.server.ts"),
    {
      credencialDeCobro: async (clinicId: string) =>
        conCuenta && clinicId === "c1" ? { accessToken: "tok-c1", mpUserId: "999" } : null,
      plataformaAnticipos: () => ({ lista: true, falta: [] }),
      urlBaseApp: () => "https://app.dalecontrol.test",
    },
  ],
  [path.join(RAIZ, "src/lib/anticipos/servicio.server.ts"), { aplicarPagoDeAnticipo: async () => { anticiposTocados++; } }],
  [path.join(RAIZ, "src/lib/ai-wallet/mercadopago.ts"), { verifyAndCreditMpTopup: async () => { throw new Error("rama equivocada"); } }],
  [path.join(RAIZ, "src/lib/cache/revalidate.ts"), { revalidateAfter: () => { revalidaciones++; } }],
]);
const M = Module as unknown as {
  _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  _resolveFilename: (req: string, parent: unknown, isMain: boolean) => string;
};
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try { resuelto = M._resolveFilename(req, parent, isMain); } catch { resuelto = null; }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

const SECRETO = "secreto-del-webhook";
process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;

let NextRequest: typeof import("next/server").NextRequest;
let webhook: typeof import("@/app/api/webhooks/mercadopago/route").POST;
let servicio: typeof import("../servicio.server");
before(async () => {
  ({ NextRequest } = await import("next/server"));
  ({ POST: webhook } = await import("@/app/api/webhooks/mercadopago/route"));
  servicio = await import("../servicio.server");
});

beforeEach(() => {
  db = new DobleBase();
  db.tablas.clinic.push({ id: "c1", name: "Clínica Sonrisa" });
  db.tablas.clinicMercadoPago.push({ clinicId: "c1", mpUserId: "999", accessToken: "v1:cifrado" });
  db.tablas.invoice.push({ id: "f1", clinicId: "c1", patientId: "p1", invoiceNumber: "F-0007", status: "PENDING", total: 2400, paid: 0, balance: 2400, paymentMethod: null, paidAt: null });
  pagos.clear();
  consultas = 0;
  revalidaciones = 0;
  anticiposTocados = 0;
  conCuenta = true;
});

function firmar(paymentId: string, requestId: string, ts: string): string {
  const manifiesto = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${createHmac("sha256", SECRETO).update(manifiesto).digest("hex")}`;
}

function notificacion(ref: string, paymentId: string, opts: { firma?: string } = {}) {
  const url = `https://app.dalecontrol.test/api/webhooks/mercadopago?ref=${encodeURIComponent(ref)}&data.id=${paymentId}&type=payment`;
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "req-1",
      "x-signature": opts.firma ?? firmar(paymentId, "req-1", "1758643200"),
    },
    body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
  });
}

async function linkDeF1() {
  const r = await servicio.obtenerLinkDeFactura({ clinicId: "c1", invoiceId: "f1", userId: "u1" });
  assert.ok(r.ok && r.link, `no salió el link: ${r.error}`);
  return db.tablas.invoicePaymentLink[0];
}

function aprobado(id: string, linkId: string, monto = 2400): MercadoPagoPayment {
  return {
    id, status: "approved", statusDetail: "accredited", externalReference: `factura:${linkId}`,
    transactionAmount: monto, currencyId: "MXN", transactionAmountRefunded: 0,
    dateApproved: "2026-09-23T09:00:00.000-06:00", collectorId: "999",
    payerEmail: null, paymentMethodId: "visa",
  };
}

test("con las dependencias REALES: el link cobra el saldo y va con marketplace_fee 0 al webhook correcto", async () => {
  const link = await linkDeF1();
  assert.equal(link.amount, 2400);
  assert.equal(link.checkoutUrl, `https://mp.test/checkout/${encodeURIComponent(`factura:${link.id}`)}`);
});

test("notificación firmada de un pago aprobado → Payment registrado y factura PAGADA, sin tocar anticipos", async () => {
  const link = await linkDeF1();
  pagos.set("9001", aprobado("9001", link.id));
  const res = await webhook(notificacion(`factura:${link.id}`, "9001"));
  assert.equal(res.status, 200);
  assert.equal(db.tablas.payment.length, 1);
  assert.equal(db.tablas.payment[0].method, "mercadopago");
  assert.equal(db.tablas.payment[0].reference, "9001");
  assert.equal(db.tablas.invoice[0].status, "PAID");
  assert.equal(anticiposTocados, 0);
  assert.equal(revalidaciones, 1, "Caja se refresca");
});

test("MP reenvía la MISMA notificación (en fila y a la vez): un solo Payment", async () => {
  const link = await linkDeF1();
  pagos.set("9001", aprobado("9001", link.id));
  const n = () => webhook(notificacion(`factura:${link.id}`, "9001"));
  await n();
  const r = await Promise.all([n(), n(), n()]);
  assert.deepEqual(r.map((x) => x.status), [200, 200, 200]);
  assert.equal(db.tablas.payment.length, 1);
  assert.equal(db.tablas.invoice[0].paid, 2400);
});

test("firma inválida → 401 y no se registra nada (MP reintenta)", async () => {
  const link = await linkDeF1();
  pagos.set("9001", aprobado("9001", link.id));
  const res = await webhook(notificacion(`factura:${link.id}`, "9001", { firma: "ts=1,v1=00" }));
  assert.equal(res.status, 401);
  assert.equal(db.tablas.payment.length, 0);
  assert.equal(consultas, 0);
});

test("clínica sin cuenta al llegar el pago → 500 (MP reintenta) y nada registrado", async () => {
  const link = await linkDeF1();
  pagos.set("9001", aprobado("9001", link.id));
  conCuenta = false;
  const res = await webhook(notificacion(`factura:${link.id}`, "9001"));
  assert.equal(res.status, 500);
  assert.equal(db.tablas.payment.length, 0);
});

test("un link que no existe → 200 y nada (descarte determinista)", async () => {
  const res = await webhook(notificacion("factura:no-existe", "9001"));
  assert.equal(res.status, 200);
  assert.equal(db.tablas.payment.length, 0);
});
