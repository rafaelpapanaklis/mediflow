/**
 * H-8 · «RECHAZÓ» Y «NO CONTESTÓ» NO SON LO MISMO.
 *
 * Run: npm run test:cfdi-timbre-incierto
 *
 * POST /api/cfdi aparta la factura antes de pedir el timbre y suelta el
 * apartado si algo falla. El agujero: si la respuesta se perdía DESPUÉS de que
 * Facturapi timbrara, la excepción llegaba igual que un rechazo, el apartado se
 * soltaba y el reintento emitía un SEGUNDO CFDI. Aquí se prueban las dos piezas
 * que lo cierran:
 *
 *   1. `pudoHaberTimbrado` — el criterio, puro.
 *   2. `createInvoice` — quien VE la respuesta y marca el error en consecuencia.
 *
 * ⛔ No se timbra nada: `fetch` está sustituido por un doble. Ni una llamada
 * sale de este proceso.
 */
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  pudoHaberTimbrado,
  marcarTimbre,
  CFDI_TIMBRE_INCIERTO_ERROR,
} from "@/lib/invoices/cfdi-timbre-incierto";

// facturapi.ts arrastra Prisma al importarse; aquí no hay base ni hace falta.
(mock as any).module("@/lib/prisma", { namedExports: { prisma: {} } });

// ═══════════════════════════════════════════════════════════════════════════
// 1 · El criterio, puro
// ═══════════════════════════════════════════════════════════════════════════

test("la marca explícita manda sobre cualquier heurística", () => {
  // Un mensaje que parece un rechazo, pero quien vio la respuesta dice «no sé».
  assert.equal(pudoHaberTimbrado(marcarTimbre(new Error("El RFC no es válido"), true)), true);
  // Y al revés: un mensaje con pinta de red, pero marcado como rechazo real.
  assert.equal(pudoHaberTimbrado(marcarTimbre(new Error("timeout del RFC"), false)), false);
});

test("un rechazo de Facturapi NO bloquea la factura", () => {
  assert.equal(pudoHaberTimbrado(new Error("El RFC del receptor no está en la lista de RFC inscritos")), false);
  assert.equal(pudoHaberTimbrado(new Error("El campo notes no está permitido")), false);
});

test("los errores de transporte cuentan como «pudo haber timbrado»", () => {
  assert.equal(pudoHaberTimbrado(new TypeError("fetch failed")), true);
  assert.equal(pudoHaberTimbrado(new Error("socket hang up")), true);
  assert.equal(pudoHaberTimbrado(new Error("ECONNRESET")), true);
  assert.equal(pudoHaberTimbrado(new Error("getaddrinfo ENOTFOUND www.facturapi.io")), true);

  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";
  assert.equal(pudoHaberTimbrado(abort), true);

  // Lo que produce AbortSignal.timeout() de verdad.
  const porTiempo = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.equal(pudoHaberTimbrado(porTiempo), true);
});

test("la causa envuelta también se mira (fetch de Node esconde ahí el error real)", () => {
  const envuelto: any = new TypeError("Failed to fetch");
  envuelto.cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  assert.equal(pudoHaberTimbrado(envuelto), true);
});

test("lo que no se reconoce cae del lado seguro", () => {
  assert.equal(pudoHaberTimbrado(undefined), true);
  assert.equal(pudoHaberTimbrado("algo raro"), true);
  assert.equal(pudoHaberTimbrado({ mensaje: "no soy un Error" }), true);
});

test("marcar un error congelado no revienta", () => {
  const congelado = Object.freeze(new Error("sellado"));
  assert.doesNotThrow(() => marcarTimbre(congelado, true));
  // Sin marca posible decide la heurística, y un mensaje neutro es «rechazo».
  assert.equal(pudoHaberTimbrado(congelado), false);
});

test("si la marca se pierde, NUESTROS mensajes de duda siguen siendo duda", () => {
  // Un error congelado no se puede marcar, y una capa futura podría rehacer el
  // Error y perder la marca. Si el texto sobrevive, el criterio sobrevive: sin
  // esto, la heurística leía nuestra propia duda como un rechazo y soltaba el
  // apartado — al revés de todo lo que dice este módulo.
  for (const m of [
    "Internal error No se sabe si el CFDI llegó a emitirse.",
    "Facturapi respondió 502 sin un motivo legible. No se sabe si el CFDI llegó a emitirse.",
    "Facturapi aceptó el timbrado pero la respuesta llegó sin UUID.",
    "Respuesta ilegible al timbrar: [object Object]",
  ]) {
    assert.equal(pudoHaberTimbrado(Object.freeze(new Error(m))), true, m);
    assert.equal(pudoHaberTimbrado(new Error(m)), true, `rehecho: ${m}`);
  }
});

test("el mensaje para la clínica dice lo único que importa", () => {
  assert.match(CFDI_TIMBRE_INCIERTO_ERROR, /no se sabe/i);
  assert.match(CFDI_TIMBRE_INCIERTO_ERROR, /segundo CFDI/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · createInvoice: quien ve la respuesta es quien marca
// ═══════════════════════════════════════════════════════════════════════════

const fetchReal = globalThis.fetch;
/** Lo que contestará el siguiente fetch. */
let responder: () => Promise<Response>;

beforeEach(() => {
  globalThis.fetch = (async () => responder()) as any;
});
afterEach(() => {
  globalThis.fetch = fetchReal;
});

function respuesta(status: number, body: string, tipo = "application/json"): Response {
  return new Response(body, { status, headers: { "Content-Type": tipo } });
}

const PARAMS = { orgApiKey: "sk_test", customerId: "cus_1", usoCfdi: "S01", items: [] as any[] };

/** El error que lanzó createInvoice, sin dejar pasar un «no lanzó». */
async function alTimbrar(): Promise<any> {
  const { createInvoice } = await import("@/lib/facturapi");
  try {
    await createInvoice(PARAMS as any);
  } catch (e) {
    return e;
  }
  assert.fail("createInvoice tenía que lanzar");
}

test("200 con UUID: devuelve el timbre", async () => {
  const { createInvoice } = await import("@/lib/facturapi");
  responder = async () => respuesta(200, JSON.stringify({
    id: "fapi_1", uuid: "UUID-1", total: 1160, pdf_url: "p", xml_url: "x",
  }));
  const r = await createInvoice(PARAMS as any);
  assert.equal(r.uuid, "UUID-1");
  assert.equal(r.id, "fapi_1");
});

test("400 con mensaje de Facturapi: RECHAZO — la factura se puede reintentar", async () => {
  responder = async () => respuesta(400, JSON.stringify({ message: "El RFC no es válido" }));
  const err = await alTimbrar();
  assert.equal(err.message, "El RFC no es válido", "el mensaje llega tal cual, como antes");
  assert.equal(pudoHaberTimbrado(err), false, "Facturapi contestó: aquí NO hay CFDI");
});

test("504 con HTML del gateway: INCIERTO — este era el que se colaba", async () => {
  // El caso exacto del hallazgo: `res.json()` reventaba con un SyntaxError que
  // parecía un rechazo, se soltaba el apartado y el reintento timbraba otra vez.
  responder = async () => respuesta(504, "<html><body>Gateway Timeout</body></html>", "text/html");
  const err = await alTimbrar();
  assert.equal(pudoHaberTimbrado(err), true);
  assert.match(err.message, /504/);
});

test("500 con JSON: INCIERTO — un 5xx no es una respuesta sobre el comprobante", async () => {
  responder = async () => respuesta(500, JSON.stringify({ message: "Internal error" }));
  assert.equal(pudoHaberTimbrado(await alTimbrar()), true);
});

test("429 (rate limit): INCIERTO", async () => {
  responder = async () => respuesta(429, JSON.stringify({ message: "Too many requests" }));
  assert.equal(pudoHaberTimbrado(await alTimbrar()), true);
});

test("400 sin cuerpo legible: RECHAZO — un 4xx es la puerta, ahí no se timbra", async () => {
  responder = async () => respuesta(400, "no soy json", "text/plain");
  const err = await alTimbrar();
  assert.equal(pudoHaberTimbrado(err), false);
  assert.match(err.message, /400/, "pero se dice qué contestó");
});

test("401 con API key caducada: RECHAZO — si no, un fallo de config atascaría la factura para siempre", async () => {
  responder = async () => respuesta(401, JSON.stringify({ message: "Invalid API key" }));
  assert.equal(pudoHaberTimbrado(await alTimbrar()), false);
});

test("la red se corta: INCIERTO", async () => {
  responder = async () => { throw new TypeError("fetch failed"); };
  const err = await alTimbrar();
  assert.equal(pudoHaberTimbrado(err), true);
});

test("200 sin UUID y SIN exigirUuid: se devuelve tal cual (contrato del instituto)", async () => {
  // Cambiar esto desde un archivo compartido le movería el suelo al vertical
  // educativo, que lleva desde siempre recibiendo «lo que vino».
  const { createInvoice } = await import("@/lib/facturapi");
  responder = async () => respuesta(200, JSON.stringify({ id: "fapi_1", total: 1160 }));
  const r = await createInvoice(PARAMS as any);
  assert.equal(r.uuid, undefined);
  assert.equal(r.id, "fapi_1");
});

test("200 sin UUID y CON exigirUuid: INCIERTO (lo que pide el dental)", async () => {
  responder = async () => respuesta(200, JSON.stringify({ id: "fapi_1", total: 1160 }));
  const { createInvoice } = await import("@/lib/facturapi");
  let err: any;
  try {
    await createInvoice({ ...PARAMS, exigirUuid: true } as any);
    assert.fail("tenía que lanzar");
  } catch (e) { err = e; }
  assert.equal(pudoHaberTimbrado(err), true);
  assert.match(err.message, /sin UUID/i);
});

test("200 con el cuerpo cortado: INCIERTO, y se relanza el error ORIGINAL", async () => {
  // 🔴 La regresión que casi meto en el instituto: si aquí se lanza un Error
  // nuevo, edu pierde el `TypeError` que es su única señal (facturacion.ts:665),
  // lo da por rechazo, LIBERA el cobro y vuelve a timbrar. Es H-8 otra vez, en
  // otro vertical. Por eso sube el error de verdad, solo que marcado.
  const original = new TypeError("terminated");
  responder = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw original; },
  } as any);
  const err = await alTimbrar();
  assert.equal(err, original, "es el MISMO objeto, no una copia");
  assert.equal(err.name, "TypeError", "y conserva el nombre que otras capas leen");
  assert.equal(pudoHaberTimbrado(err), true);
});

test("200 con HTML: INCIERTO", async () => {
  responder = async () => respuesta(200, "<html>oops</html>", "text/html");
  assert.equal(pudoHaberTimbrado(await alTimbrar()), true);
});
