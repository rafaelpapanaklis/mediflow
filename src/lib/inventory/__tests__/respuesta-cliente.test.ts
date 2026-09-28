// ws1-t5 — la pantalla de Inventario solo pinta lo que el servidor confirmó.
// Correr: npm run test:inventario-arreglos

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cantidadDe, esArticulo, leerRespuesta, type RespuestaHttp } from "../respuesta-cliente";

const respuesta = (ok: boolean, cuerpo: unknown): RespuestaHttp => ({ ok, json: async () => cuerpo });
const sinJson = (ok: boolean): RespuestaHttp => ({
  ok,
  json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
});

describe("leerRespuesta", () => {
  it("2xx con JSON: ok y los datos tal cual", async () => {
    const r = await leerRespuesta<{ quantity: number }>(respuesta(true, { id: "a", quantity: 7 }));
    assert.deepEqual(r, { ok: true, datos: { id: "a", quantity: 7 }, error: null });
  });

  it("403 de solo lectura: NO es ok, y trae el mensaje del servidor", async () => {
    const r = await leerRespuesta(respuesta(false, { error: "No tienes permiso para editar inventario" }));
    assert.deepEqual(r, { ok: false, datos: null, error: "No tienes permiso para editar inventario" });
  });

  it("404: el mensaje del servidor", async () => {
    const r = await leerRespuesta(respuesta(false, { error: "Insumo no encontrado" }));
    assert.deepEqual(r, { ok: false, datos: null, error: "Insumo no encontrado" });
  });

  it("500 con una página HTML en vez de JSON: no es ok, sin mensaje", async () => {
    assert.deepEqual(await leerRespuesta(sinJson(false)), { ok: false, datos: null, error: null });
  });

  it("error sin campo `error`, o con uno que no es texto: sin mensaje", async () => {
    assert.deepEqual(await leerRespuesta(respuesta(false, {})), { ok: false, datos: null, error: null });
    assert.deepEqual(await leerRespuesta(respuesta(false, { error: { code: 1 } })), { ok: false, datos: null, error: null });
    assert.deepEqual(await leerRespuesta(respuesta(false, { error: "   " })), { ok: false, datos: null, error: null });
    assert.deepEqual(await leerRespuesta(respuesta(false, null)), { ok: false, datos: null, error: null });
  });

  it("2xx con un cuerpo que no es JSON tampoco es ok", async () => {
    assert.deepEqual(await leerRespuesta(sinJson(true)), { ok: false, datos: null, error: null });
  });
});

describe("cantidadDe: la existencia que se va a pintar", () => {
  it("la del servidor, incluido el cero", () => {
    assert.equal(cantidadDe({ quantity: 12 }), 12);
    assert.equal(cantidadDe({ quantity: 0 }), 0);
  });

  it("el cuerpo de un error no trae existencia: null, nunca undefined", () => {
    assert.equal(cantidadDe({ error: "Unauthorized" }), null);
    assert.equal(cantidadDe({ quantity: "12" }), null);
    assert.equal(cantidadDe({ quantity: NaN }), null);
    assert.equal(cantidadDe(null), null);
    assert.equal(cantidadDe("12"), null);
  });
});

describe("esArticulo: lo que se añade a la lista tras el alta", () => {
  it("un artículo de verdad", () => {
    assert.equal(esArticulo({ id: "cm1", name: "Guantes", quantity: 0 }), true);
  });

  it("el cuerpo de un error no entra en la lista", () => {
    assert.equal(esArticulo({ error: "Nombre y categoría son requeridos" }), false);
    assert.equal(esArticulo({ id: "", name: "Guantes", quantity: 1 }), false);
    assert.equal(esArticulo({ id: "cm1", name: "Guantes" }), false);
    assert.equal(esArticulo(null), false);
  });
});
