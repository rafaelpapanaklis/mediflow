// ronda 3 (ws1-t2) — H6: «Cobrar» una mensualidad precargaba el SALDO
// COMPLETO de la factura (p. ej. $36,000 de un tratamiento) en vez del monto
// de esa cuota ($2,000). Si alguien vuelve a olvidar el `montoSugerido`, o
// deja pasar un sugerido mayor que el saldo, estas pruebas fallan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { montoInicialDeCobro } from "../monto-inicial-cobro";

test("con montoSugerido: precarga la mensualidad, no el saldo completo", () => {
  // Caja → Cobrar la mensualidad de $6,000 de un tratamiento con saldo $36,000.
  assert.equal(montoInicialDeCobro(6000, 36000), 6000);
});

test("sin montoSugerido: se mantiene el saldo completo (Registrar pago de una factura suelta)", () => {
  assert.equal(montoInicialDeCobro(undefined, 36000), 36000);
});

test("montoSugerido mayor que el saldo (no debería pasar): se clampea, nunca nace en sobrepago", () => {
  assert.equal(montoInicialDeCobro(50000, 36000), 36000);
});

test("montoSugerido en 0 o negativo: se ignora, cae al saldo completo", () => {
  assert.equal(montoInicialDeCobro(0, 36000), 36000);
  assert.equal(montoInicialDeCobro(-100, 36000), 36000);
});

test("saldo negativo o inválido nunca produce un monto inicial negativo", () => {
  assert.equal(montoInicialDeCobro(undefined, -5), 0);
  assert.equal(montoInicialDeCobro(undefined, NaN), 0);
});
