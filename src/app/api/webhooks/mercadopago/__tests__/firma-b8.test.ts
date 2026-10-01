/**
 * B8 (auditoría 30-sep-2026) — webhook de Mercado Pago: falla cerrado sin
 * secreto y la firma se liga al id del pago que se procesa.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verificarFirmaMp } from "@/lib/mercadopago-firma";

const SECRETO = "secreto-del-webhook";

function firmar(dataId: string, requestId: string | null = "req-1", ts = "1758643200", secreto = SECRETO) {
  let m = `id:${dataId.toLowerCase()};`;
  if (requestId) m += `request-id:${requestId};`;
  m += `ts:${ts};`;
  return `ts=${ts},v1=${createHmac("sha256", secreto).update(m).digest("hex")}`;
}

// ═══ Piezas puras ═══════════════════════════════════════════════════════════
test("firma válida: devuelve el id FIRMADO (el de la query)", () => {
  const r = verificarFirmaMp({ secret: SECRETO, signature: firmar("123"), requestId: "req-1", dataIdQuery: "123", idsDelBody: ["123", 123] });
  assert.deepEqual(r, { ok: true, paymentId: "123" });
});

test("sin secreto NO pasa (falla cerrado)", () => {
  for (const secret of [undefined, null, ""]) {
    const r = verificarFirmaMp({ secret, signature: firmar("123"), requestId: "req-1", dataIdQuery: "123" });
    assert.deepEqual(r, { ok: false, motivo: "sin_secreto" });
  }
});

test("firma ausente, mal formada, de otro secreto o de otro id no pasa", () => {
  const base = { secret: SECRETO, requestId: "req-1", dataIdQuery: "123" };
  assert.equal((verificarFirmaMp({ ...base, signature: null }) as any).motivo, "firma_ausente");
  assert.equal((verificarFirmaMp({ ...base, signature: "basura" }) as any).motivo, "firma_ausente");
  assert.equal((verificarFirmaMp({ ...base, signature: firmar("123", "req-1", "1", "otro-secreto") }) as any).motivo, "firma_invalida");
  assert.equal((verificarFirmaMp({ ...base, signature: firmar("999") }) as any).motivo, "firma_invalida");
});

test("la firma de un pago NO sirve para procesar otro: el id del body tiene que ser el firmado", () => {
  const r = verificarFirmaMp({
    secret: SECRETO, signature: firmar("123"), requestId: "req-1", dataIdQuery: "123", idsDelBody: ["999"],
  });
  assert.deepEqual(r, { ok: false, motivo: "id_no_coincide" });
  const r2 = verificarFirmaMp({
    secret: SECRETO, signature: firmar("123"), requestId: "req-1", dataIdQuery: "123", idsDelBody: ["123", "999"],
  });
  assert.equal((r2 as any).motivo, "id_no_coincide");
});

test("sin data.id en la query la firma no liga ningún pago: se rechaza aunque el body traiga uno", () => {
  const r = verificarFirmaMp({
    secret: SECRETO, signature: firmar("", "req-1"), requestId: "req-1", dataIdQuery: null, idsDelBody: ["123"],
  });
  assert.deepEqual(r, { ok: false, motivo: "sin_data_id" });
});

test("ids alfanuméricos: la comparación ignora mayúsculas como el manifest de MP", () => {
  const r = verificarFirmaMp({ secret: SECRETO, signature: firmar("AbC123"), requestId: "req-1", dataIdQuery: "AbC123", idsDelBody: ["abc123"] });
  assert.equal(r.ok, true);
});

// ═══ La ruta ═════════════════════════════════════════════════════════════════
let anticipos: Array<[string, string]>;
beforeEach(() => {
  anticipos = [];
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;
});

(mock as any).module("@/lib/prisma", { namedExports: { prisma: {} } });
(mock as any).module("@/lib/mercadopago", { namedExports: { getPayment: async () => null } });
(mock as any).module("@/lib/ai-wallet/mercadopago", { namedExports: { verifyAndCreditMpTopup: async () => undefined } });
(mock as any).module("@/lib/factura-mp/servicio.server", { namedExports: { aplicarPagoDeFactura: async () => ({ aplicado: false }) } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined } });
(mock as any).module("@/lib/anticipos/servicio.server", {
  namedExports: { aplicarPagoDeAnticipo: async (o: string, p: string) => { anticipos.push([o, p]); } },
});

function notificacion(o: { query: string; headers?: Record<string, string>; body?: unknown }) {
  return {
    url: `https://app.test/api/webhooks/mercadopago?${o.query}`,
    headers: new Headers(o.headers ?? {}),
    json: async () => o.body ?? {},
  } as any;
}
const POSTEAR = async (req: any) => (await import("@/app/api/webhooks/mercadopago/route")).POST(req);

test("ruta: sin MERCADOPAGO_WEBHOOK_SECRET responde 503 y NO procesa nada", async () => {
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const res = await POSTEAR(notificacion({
    query: "ref=anticipo:d1&data.id=123",
    headers: { "x-request-id": "req-1", "x-signature": firmar("123") },
    body: { data: { id: "123" } },
  }));
  assert.equal(res.status, 503);
  assert.deepEqual(anticipos, []);
});

test("ruta: notificación bien firmada procesa el pago firmado", async () => {
  const res = await POSTEAR(notificacion({
    query: "ref=anticipo:d1&data.id=123&type=payment",
    headers: { "x-request-id": "req-1", "x-signature": firmar("123") },
    body: { type: "payment", data: { id: "123" } },
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(anticipos, [["d1", "123"]]);
});

test("ruta: firma legítima de un pago reutilizada con OTRO id en el body es 401 y no procesa nada", async () => {
  const res = await POSTEAR(notificacion({
    query: "ref=anticipo:d1&data.id=123&type=payment",
    headers: { "x-request-id": "req-1", "x-signature": firmar("123") },
    body: { data: { id: "999" } },
  }));
  assert.equal(res.status, 401);
  assert.deepEqual(anticipos, []);
});

test("ruta: sin firma, o con firma de otro secreto, es 401", async () => {
  const sinFirma = await POSTEAR(notificacion({ query: "ref=anticipo:d1&data.id=123", body: { data: { id: "123" } } }));
  assert.equal(sinFirma.status, 401);
  const otra = await POSTEAR(notificacion({
    query: "ref=anticipo:d1&data.id=123",
    headers: { "x-request-id": "req-1", "x-signature": firmar("123", "req-1", "1758643200", "otro") },
    body: { data: { id: "123" } },
  }));
  assert.equal(otra.status, 401);
  assert.deepEqual(anticipos, []);
});
