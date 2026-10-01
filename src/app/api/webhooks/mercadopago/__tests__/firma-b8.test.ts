/**
 * B8 (auditoría 30-sep-2026) — webhook de Mercado Pago: falla cerrado sin
 * secreto y la firma se liga al id del pago que se procesa.
 *
 * ws1-t12 (1-oct-2026): con notificaciones REALES. En el cuerpo que manda MP el
 * `id` de la raíz es el de la NOTIFICACIÓN y `data.id` el del pago; la versión
 * anterior exigía que fueran iguales y daba 401 a todo pago real. Las pruebas de
 * antes nunca mandaban `id` en la raíz (el ejemplo de la doc pone el mismo
 * número en los dos), por eso no lo vieron.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verificarFirmaMp } from "@/lib/mercadopago-firma";

const SECRETO = "secreto-del-webhook";

/** Firma como la doc oficial: HMAC-SHA256(secreto, `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`),
 *  omitiendo las partes que no vienen. */
function firmar(dataId: string, requestId: string | null = "req-1", ts = "1758643200", secreto = SECRETO) {
  let m = "";
  if (dataId) m += `id:${dataId};`;
  if (requestId) m += `request-id:${requestId};`;
  m += `ts:${ts};`;
  return `ts=${ts},v1=${createHmac("sha256", secreto).update(m).digest("hex")}`;
}

// ═══ Piezas puras ═══════════════════════════════════════════════════════════
test("firma válida: devuelve el id FIRMADO (el de la query)", () => {
  const r = verificarFirmaMp({ secret: SECRETO, signature: firmar("123"), requestId: "req-1", dataIdQuery: "123", dataIdBody: "123" });
  assert.deepEqual(r, { ok: true, paymentId: "123" });
  const numerico = verificarFirmaMp({ secret: SECRETO, signature: firmar("123"), requestId: "req-1", dataIdQuery: "123", dataIdBody: 123 });
  assert.deepEqual(numerico, { ok: true, paymentId: "123" });
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
  // La firma cubre el x-request-id: con otro request-id ya no vale.
  assert.equal((verificarFirmaMp({ ...base, requestId: "req-2", signature: firmar("123") }) as any).motivo, "firma_invalida");
});

test("la firma de un pago NO sirve para procesar otro: el data.id del body tiene que ser el firmado", () => {
  const r = verificarFirmaMp({
    secret: SECRETO, signature: firmar("123"), requestId: "req-1", dataIdQuery: "123", dataIdBody: "999",
  });
  assert.deepEqual(r, { ok: false, motivo: "id_no_coincide" });
});

test("sin data.id en la query vale el data.id del body, ligado por la firma", () => {
  const r = verificarFirmaMp({ secret: SECRETO, signature: firmar("123"), requestId: "req-1", dataIdQuery: null, dataIdBody: "123" });
  assert.deepEqual(r, { ok: true, paymentId: "123" });
  // …y una firma de otro id no lo cubre.
  const otra = verificarFirmaMp({ secret: SECRETO, signature: firmar("999"), requestId: "req-1", dataIdQuery: null, dataIdBody: "123" });
  assert.equal((otra as any).motivo, "firma_invalida");
});

test("sin data.id en ningún lado no hay pago que ligar: se rechaza", () => {
  const r = verificarFirmaMp({ secret: SECRETO, signature: firmar("", "req-1"), requestId: "req-1", dataIdQuery: null, dataIdBody: undefined });
  assert.deepEqual(r, { ok: false, motivo: "sin_data_id" });
});

test("sin x-request-id el manifest lo omite (regla de la doc)", () => {
  const r = verificarFirmaMp({ secret: SECRETO, signature: firmar("123", null), requestId: null, dataIdQuery: "123" });
  assert.deepEqual(r, { ok: true, paymentId: "123" });
});

test("ids alfanuméricos: vale la firma en minúsculas (doc) y la del id tal cual (sdk-nodejs)", () => {
  const minus = verificarFirmaMp({ secret: SECRETO, signature: firmar("abc123"), requestId: "req-1", dataIdQuery: "AbC123", dataIdBody: "abc123" });
  assert.equal(minus.ok, true);
  const tal = verificarFirmaMp({ secret: SECRETO, signature: firmar("AbC123"), requestId: "req-1", dataIdQuery: "AbC123" });
  assert.equal(tal.ok, true);
});

// ═══ La ruta, con notificaciones como las manda MP ═══════════════════════════
let procesados: Array<[string, string, string]>;
let errores: string[];
const consoleError = console.error;
beforeEach(() => {
  procesados = [];
  errores = [];
  process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;
  // Solo los logs de la ruta (el aviso de «module mocking» de Node también sale por aquí).
  console.error = (...a: unknown[]) => {
    const linea = a.map(String).join(" ");
    if (linea.startsWith("MercadoPago webhook")) errores.push(linea);
  };
});
afterEach(() => { console.error = consoleError; });

const ORDEN_LAB = { id: "lab1", total: 500, paymentStatus: "PENDING", lab: { mpAccessToken: "tok-lab" } };
const labActualizados: unknown[] = [];
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      dentalLabOrder: {
        findUnique: async () => ORDEN_LAB,
        update: async (a: unknown) => { labActualizados.push(a); return a; },
      },
      supplierOrder: {
        findUnique: async () => ({ id: "sup1", total: 500, paymentStatus: "PENDING", supplier: { mpAccessToken: "tok-sup" } }),
        update: async (a: unknown) => a,
      },
    },
  },
});
(mock as any).module("@/lib/mercadopago", {
  namedExports: {
    getPayment: async (token: string, id: string) => {
      procesados.push(["getPayment", token, id]);
      return { id, status: "approved", externalReference: "lab1", transactionAmount: 500 };
    },
  },
});
(mock as any).module("@/lib/ai-wallet/mercadopago", {
  namedExports: { verifyAndCreditMpTopup: async (o: string, p: string) => { procesados.push(["aitopup", o, p]); } },
});
(mock as any).module("@/lib/factura-mp/servicio.server", {
  namedExports: { aplicarPagoDeFactura: async (o: string, p: string) => { procesados.push(["factura", o, p]); return { aplicado: false }; } },
});
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => undefined } });
(mock as any).module("@/lib/anticipos/servicio.server", {
  namedExports: { aplicarPagoDeAnticipo: async (o: string, p: string) => { procesados.push(["anticipo", o, p]); } },
});

function notificacion(o: { query: string; headers?: Record<string, string>; body?: unknown }) {
  return {
    url: `https://app.test/api/webhooks/mercadopago?${o.query}`,
    headers: new Headers(o.headers ?? {}),
    json: async () => o.body ?? {},
  } as any;
}
const POSTEAR = async (req: any) => (await import("@/app/api/webhooks/mercadopago/route")).POST(req);

/** Cuerpo de un webhook de pago tal como lo manda MP (doc oficial, Webhooks):
 *  `id` = la NOTIFICACIÓN, `data.id` = el PAGO. Distintos, como en producción. */
function cuerpoDePago(pagoId: string, accion = "payment.updated") {
  return {
    id: 12345678901,
    live_mode: true,
    type: "payment",
    date_created: "2026-10-01T15:04:58.396-04:00",
    user_id: 44444,
    api_version: "v1",
    action: accion,
    data: { id: pagoId },
  };
}
const PAGO = "1324567890";
const FIRMADO = { "x-request-id": "bb56a2f1-6aae-46ac-982e-9dcd3581d08e", "x-signature": firmar(PAGO, "bb56a2f1-6aae-46ac-982e-9dcd3581d08e") };

test("ruta: pago real (id de la notificación ≠ data.id) con firma válida → 200 y se procesa ESE pago", async () => {
  for (const accion of ["payment.created", "payment.updated"]) {
    procesados = [];
    const res = await POSTEAR(notificacion({
      query: `ref=anticipo:d1&data.id=${PAGO}&type=payment`,
      headers: FIRMADO,
      body: cuerpoDePago(PAGO, accion),
    }));
    assert.equal(res.status, 200, accion);
    assert.deepEqual(procesados, [["anticipo", "d1", PAGO]]);
  }
  assert.deepEqual(errores, []);
});

test("ruta: los cinco rieles (anticipo, factura, recarga IA, laboratorio, proveedor) reciben el pago real", async () => {
  for (const [ref, esperado] of [
    ["anticipo:d1", ["anticipo", "d1", PAGO]],
    ["factura:l1", ["factura", "l1", PAGO]],
    ["aitopup:t1", ["aitopup", "t1", PAGO]],
    ["lab:lab1", ["getPayment", "tok-lab", PAGO]],
    ["sup:sup1", ["getPayment", "tok-sup", PAGO]],
  ] as const) {
    procesados = [];
    const res = await POSTEAR(notificacion({ query: `ref=${ref}&data.id=${PAGO}&type=payment`, headers: FIRMADO, body: cuerpoDePago(PAGO) }));
    assert.equal(res.status, 200, ref);
    assert.deepEqual(procesados, [esperado], ref);
  }
  assert.equal((labActualizados.at(-1) as any)?.data?.mpPaymentId, PAGO);
});

test("ruta: data.id solo en el body (la query no lo trae) con firma válida → 200 y se procesa", async () => {
  const res = await POSTEAR(notificacion({ query: "ref=anticipo:d1", headers: FIRMADO, body: cuerpoDePago(PAGO) }));
  assert.equal(res.status, 200);
  assert.deepEqual(procesados, [["anticipo", "d1", PAGO]]);
});

test("ruta: data.id solo en la query (body vacío o no JSON) con firma válida → 200 y se procesa", async () => {
  const res = await POSTEAR(notificacion({ query: `ref=anticipo:d1&data.id=${PAGO}&type=payment`, headers: FIRMADO }));
  assert.equal(res.status, 200);
  assert.deepEqual(procesados, [["anticipo", "d1", PAGO]]);
});

test("ruta: sin x-request-id, firmada sin esa parte → 200 y se procesa", async () => {
  const res = await POSTEAR(notificacion({
    query: `ref=anticipo:d1&data.id=${PAGO}&type=payment`,
    headers: { "x-signature": firmar(PAGO, null) },
    body: cuerpoDePago(PAGO),
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(procesados, [["anticipo", "d1", PAGO]]);
});

test("ruta: merchant_order firmada → 200 SIN procesar nada (su data.id no es un pago)", async () => {
  const orden = "9876543210";
  const res = await POSTEAR(notificacion({
    query: `ref=anticipo:d1&data.id=${orden}&type=topic_merchant_order_wh`,
    headers: { "x-request-id": "req-mo", "x-signature": firmar(orden, "req-mo") },
    body: {
      action: "update", api_version: "v1", application_id: "2123456789", date_created: "2026-10-01T15:05:01.000-04:00",
      id: orden, live_mode: true, status: "closed", type: "topic_merchant_order_wh", version: 3,
      data: { currency_id: "MXN", marketplace: "NONE", status: "closed" },
    },
  }));
  assert.equal(res.status, 200);
  assert.deepEqual(procesados, []);
});

test("ruta: merchant_order con firma mala → 401", async () => {
  const res = await POSTEAR(notificacion({
    query: "ref=anticipo:d1&data.id=9876543210&type=topic_merchant_order_wh",
    headers: { "x-request-id": "req-mo", "x-signature": firmar("9876543210", "req-mo", "1758643200", "otro") },
    body: { id: "9876543210", type: "topic_merchant_order_wh", data: {} },
  }));
  assert.equal(res.status, 401);
  assert.deepEqual(procesados, []);
});

test("ruta: sin MERCADOPAGO_WEBHOOK_SECRET responde 503, NO procesa nada y lo dice en el log", async () => {
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const res = await POSTEAR(notificacion({
    query: `ref=anticipo:d1&data.id=${PAGO}&type=payment`,
    headers: FIRMADO,
    body: cuerpoDePago(PAGO),
  }));
  assert.equal(res.status, 503);
  assert.deepEqual(procesados, []);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /MERCADOPAGO_WEBHOOK_SECRET no está configurado/);
});

test("ruta: firma legítima de un pago reutilizada con OTRO data.id en el body es 401 y no procesa nada", async () => {
  const res = await POSTEAR(notificacion({
    query: `ref=anticipo:d1&data.id=${PAGO}&type=payment`,
    headers: FIRMADO,
    body: cuerpoDePago("999"),
  }));
  assert.equal(res.status, 401);
  assert.deepEqual(procesados, []);
  assert.match(errores[0], /id_no_coincide/);
});

test("ruta: sin firma, con firma de otro secreto o de otro pago es 401 con el motivo en el log", async () => {
  const sinFirma = await POSTEAR(notificacion({ query: `ref=anticipo:d1&data.id=${PAGO}`, body: cuerpoDePago(PAGO) }));
  assert.equal(sinFirma.status, 401);
  const otra = await POSTEAR(notificacion({
    query: `ref=anticipo:d1&data.id=${PAGO}`,
    headers: { "x-request-id": "req-1", "x-signature": firmar(PAGO, "req-1", "1758643200", "otro") },
    body: cuerpoDePago(PAGO),
  }));
  assert.equal(otra.status, 401);
  // Firmar con el id de la NOTIFICACIÓN (lo que el arreglo anterior acababa exigiendo) no vale.
  const conIdDeNotificacion = await POSTEAR(notificacion({
    query: `ref=anticipo:d1&data.id=${PAGO}`,
    headers: { "x-request-id": "req-1", "x-signature": firmar("12345678901") },
    body: cuerpoDePago(PAGO),
  }));
  assert.equal(conIdDeNotificacion.status, 401);
  assert.deepEqual(procesados, []);
  assert.match(errores[0], /firma_ausente/);
  assert.match(errores[1], /firma_invalida/);
});

// ws1-t5 (1-oct-2026): el tipo de la notificación también puede venir SOLO en el
// cuerpo (`type` o `topic`), o con la query vacía (`type=`). Una orden de
// comercio firmada no es un pago: 200 sin llamar a getPayment con el id de otra cosa.
test("ruta: el tipo (type/topic) leído del cuerpo o con la query vacía descarta lo que no es pago", async () => {
  const REF = "ref=lab:lab1";
  const casos: Array<[string, string, Record<string, unknown>]> = [
    ["topic en el cuerpo, query sin tipo", `${REF}&data.id=${PAGO}`, { topic: "merchant_order", data: { id: PAGO } }],
    ["type en el cuerpo, query sin tipo", `${REF}&data.id=${PAGO}`, { type: "merchant_order", data: { id: PAGO } }],
    ["type vacío en la query, topic en el cuerpo", `${REF}&data.id=${PAGO}&type=`, { topic: "merchant_order", data: { id: PAGO } }],
    ["type vacío y topic vacío en la query, type en el cuerpo", `${REF}&data.id=${PAGO}&type=&topic=`, { type: "chargebacks", data: { id: PAGO } }],
  ];
  for (const [nombre, query, body] of casos) {
    procesados.length = 0;
    const res = await POSTEAR(notificacion({ query, headers: FIRMADO, body }));
    assert.equal(res.status, 200, nombre);
    assert.deepEqual(procesados, [], `${nombre}: no debía procesar nada`);
  }
});

test("ruta: sin tipo en ningún lado (formato viejo) o con type=payment en el cuerpo sigue procesando el pago", async () => {
  for (const [query, body] of [
    [`ref=lab:lab1&data.id=${PAGO}`, { data: { id: PAGO } }],
    [`ref=lab:lab1&data.id=${PAGO}&type=`, { type: "payment", data: { id: PAGO } }],
    [`ref=lab:lab1&data.id=${PAGO}`, { topic: "payment", data: { id: PAGO } }],
  ] as Array<[string, Record<string, unknown>]>) {
    procesados.length = 0;
    const res = await POSTEAR(notificacion({ query, headers: FIRMADO, body }));
    assert.equal(res.status, 200);
    assert.deepEqual(procesados[0], ["getPayment", "tok-lab", PAGO], query);
  }
});
