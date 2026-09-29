import { test } from "node:test";
import assert from "node:assert/strict";
import { cajaAbiertaDeRespuesta, debeAvisarCajaCerrada } from "../aviso-caja-cerrada";

test("solo se avisa con efectivo y la caja CERRADA", () => {
  assert.equal(debeAvisarCajaCerrada("cash", false), true);
  assert.equal(debeAvisarCajaCerrada("cash", true), false);
  assert.equal(debeAvisarCajaCerrada("transfer", false), false);
  assert.equal(debeAvisarCajaCerrada("card_debit", false), false);
});

test("si no se pudo saber, no se avisa", () => {
  assert.equal(debeAvisarCajaCerrada("cash", null), false);
});

test("lee la caja de /api/caja/current", () => {
  assert.equal(cajaAbiertaDeRespuesta(200, { register: { id: "r1" } }), true);
  assert.equal(cajaAbiertaDeRespuesta(200, { register: null }), false);
  assert.equal(cajaAbiertaDeRespuesta(403, { error: "sin permiso" }), null);
  assert.equal(cajaAbiertaDeRespuesta(200, null), null);
  assert.equal(cajaAbiertaDeRespuesta(200, {}), null);
});
