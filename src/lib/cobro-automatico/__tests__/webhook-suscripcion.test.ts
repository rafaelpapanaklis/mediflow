/**
 * El webhook de Mercado Pago ENTERO con avisos de SUSCRIPCIÓN (ws1-t6).
 *
 * Corre de verdad `POST /api/webhooks/mercadopago` —la firma x-signature (la
 * misma de c39d2327: manifest `id:<data.id>;request-id:…;ts:…;`, `id` de la raíz
 * ≠ `data.id`)— y sustituye por ruta resuelta el servicio del cobro automático
 * (aquí solo importa QUÉ le pasa la ruta) y las otras ramas. Ni red ni base.
 *
 * Con el código de antes (sin la rama de suscripciones) estos avisos respondían
 * 200 SIN procesarse: los cobros aprobados nunca se habrían registrado.
 *
 * Run: npm run test:cobro-automatico
 */
import Module from "node:module";
import path from "node:path";
import { createHmac } from "node:crypto";
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");

const avisos: Array<{ tipo: string; dataId: string; mpUserId: string | null }> = [];
let falla: Error | null = null;
let otrasRamas = 0;
const prohibido = new Proxy({}, { get: (_t, k) => { throw new Error(`prueba: nadie debe tocar la base real (prisma.${String(k)})`); } });

const dobles = new Map<string, unknown>([
  [path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prohibido }],
  [
    path.join(RAIZ, "src/lib/cobro-automatico/servicio.server.ts"),
    {
      esAvisoDeSuscripcion: (t: string | null) => t === "subscription_preapproval" || t === "subscription_authorized_payment",
      procesarAvisoDeSuscripcion: async (a: { tipo: string; dataId: string; mpUserId: string | null }) => {
        avisos.push(a);
        if (falla) throw falla;
        return "ok";
      },
    },
  ],
  [path.join(RAIZ, "src/lib/mercadopago.ts"), { getPayment: async () => { otrasRamas++; return null; } }],
  [path.join(RAIZ, "src/lib/anticipos/servicio.server.ts"), { aplicarPagoDeAnticipo: async () => { otrasRamas++; } }],
  [path.join(RAIZ, "src/lib/factura-mp/servicio.server.ts"), { aplicarPagoDeFactura: async () => { otrasRamas++; return { aplicado: false }; } }],
  [path.join(RAIZ, "src/lib/ai-wallet/mercadopago.ts"), { verifyAndCreditMpTopup: async () => { otrasRamas++; } }],
  [path.join(RAIZ, "src/lib/cache/revalidate.ts"), { revalidateAfter: () => {} }],
]);
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown; _resolveFilename: (r: string, p: unknown, m: boolean) => string };
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let r: string | null = null;
  try { r = M._resolveFilename(req, parent, isMain); } catch { r = null; }
  if (r && dobles.has(r)) return dobles.get(r);
  return cargaOriginal.call(this, req, parent, isMain);
};

const SECRETO = "secreto-del-webhook";
process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;

let NextRequest: typeof import("next/server").NextRequest;
let webhook: typeof import("@/app/api/webhooks/mercadopago/route").POST;
before(async () => {
  ({ NextRequest } = await import("next/server"));
  ({ POST: webhook } = await import("@/app/api/webhooks/mercadopago/route"));
});

beforeEach(() => {
  avisos.length = 0;
  falla = null;
  otrasRamas = 0;
});

function firmar(dataId: string, requestId = "req-1", ts = "1758643200", secreto = SECRETO): string {
  return `ts=${ts},v1=${createHmac("sha256", secreto).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex")}`;
}

/** Como llega de «Tus integraciones»: sin `ref`, con `data.id` y `type` en la query, `id` de la raíz = la NOTIFICACIÓN. */
function aviso(tipo: string, dataId: string, o: { firma?: string; enQuery?: boolean; cuerpoId?: string } = {}) {
  const q = o.enQuery === false ? "" : `?data.id=${encodeURIComponent(dataId)}&type=${tipo}`;
  return new NextRequest(`https://app.dalecontrol.test/api/webhooks/mercadopago${q}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "req-1", "x-signature": o.firma ?? firmar(dataId) },
    body: JSON.stringify({
      id: 123456789, live_mode: true, type: tipo, date_created: "2026-03-05T10:04:58.396-06:00", user_id: 999,
      api_version: "v1", action: `${tipo}.updated`, data: { id: o.cuerpoId ?? dataId },
    }),
  });
}

test("cobro de suscripción firmado → se procesa con el id FIRMADO y la cuenta del vendedor; 200", async () => {
  const r = await webhook(aviso("subscription_authorized_payment", "6114264375"));
  assert.equal(r.status, 200);
  assert.deepEqual(avisos, [{ tipo: "subscription_authorized_payment", dataId: "6114264375", mpUserId: "999" }]);
  assert.equal(otrasRamas, 0, "no cae en las ramas de pagos");
});

test("la suscripción (id alfanumérico) firmada → se procesa; también si el id solo viene en el cuerpo", async () => {
  const pre = "2c9380847e9b451c017ea1bd70ba0219";
  assert.equal((await webhook(aviso("subscription_preapproval", pre))).status, 200);
  // Sin data.id en la query: la firma liga el del cuerpo (mismo criterio que c39d2327). El tipo sale del cuerpo.
  assert.equal((await webhook(aviso("subscription_preapproval", pre, { enQuery: false }))).status, 200);
  assert.deepEqual(avisos.map((a) => a.dataId), [pre, pre]);
});

test("firma inválida, de otro id, o con otro data.id en el cuerpo → 401 y NO se procesa", async () => {
  assert.equal((await webhook(aviso("subscription_authorized_payment", "61", { firma: firmar("61", "req-1", "1", "otro") }))).status, 401);
  assert.equal((await webhook(aviso("subscription_authorized_payment", "61", { firma: firmar("62") }))).status, 401);
  assert.equal((await webhook(aviso("subscription_authorized_payment", "61", { cuerpoId: "99" }))).status, 401);
  assert.equal(avisos.length, 0);
});

test("falla transitoria (MP caído, base, cuenta sin token) → 500 para que MP reintente", async () => {
  falla = new Error("MercadoPago error 503");
  assert.equal((await webhook(aviso("subscription_authorized_payment", "61"))).status, 500);
});

test("los demás tipos siguen como antes: plan de suscripción y merchant_order → 200 sin procesar", async () => {
  assert.equal((await webhook(aviso("subscription_preapproval_plan", "77"))).status, 200);
  assert.equal((await webhook(aviso("topic_merchant_order_wh", "78"))).status, 200);
  assert.equal(avisos.length, 0);
  assert.equal(otrasRamas, 0);
});
