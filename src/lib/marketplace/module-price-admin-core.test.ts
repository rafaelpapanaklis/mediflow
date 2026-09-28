/**
 * Precio de un módulo editable desde /admin/settings.
 *
 *   npx tsx --test src/lib/marketplace/module-price-admin-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRECIO_MODULO_MAXIMO_MXN,
  descuentoAnualPct,
  moduloEnVenta,
  validarPrecioModulo,
} from "./module-price-admin-core";

test("acepta el precio de hoy de Ortodoncia, venga como número o como texto del formulario", () => {
  assert.deepEqual(validarPrecioModulo({ priceMxnMonthly: 129, priceMxnAnnual: 1316 }), {
    ok: true,
    precio: { priceMxnMonthly: 129, priceMxnAnnual: 1316 },
  });
  assert.deepEqual(validarPrecioModulo({ priceMxnMonthly: "129", priceMxnAnnual: "1316" }), {
    ok: true,
    precio: { priceMxnMonthly: 129, priceMxnAnnual: 1316 },
  });
});

test("el anual vacío significa «no se ofrece pago anual», no «gratis»", () => {
  for (const vacio of [null, undefined, "", "  "]) {
    assert.deepEqual(validarPrecioModulo({ priceMxnMonthly: 129, priceMxnAnnual: vacio }), {
      ok: true,
      precio: { priceMxnMonthly: 129, priceMxnAnnual: null },
    });
  }
});

test("el mensual es obligatorio y nunca 0 ni negativo (un módulo a $0 se regalaría en el checkout)", () => {
  for (const malo of [0, -5, "", null, undefined, "abc", NaN, Infinity]) {
    const r = validarPrecioModulo({ priceMxnMonthly: malo, priceMxnAnnual: null });
    assert.equal(r.ok, false, `aceptó ${String(malo)}`);
  }
});

test("sin centavos: las columnas son enteras", () => {
  assert.equal(validarPrecioModulo({ priceMxnMonthly: 129.5, priceMxnAnnual: null }).ok, false);
  assert.equal(validarPrecioModulo({ priceMxnMonthly: 129, priceMxnAnnual: 1315.8 }).ok, false);
});

test("un anual de 0 se rechaza: para no ofrecerlo se deja vacío", () => {
  const r = validarPrecioModulo({ priceMxnMonthly: 129, priceMxnAnnual: 0 });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /déjalo vacío/);
});

test("el anual no puede costar más que doce meses", () => {
  assert.equal(validarPrecioModulo({ priceMxnMonthly: 129, priceMxnAnnual: 1548 }).ok, true);
  const r = validarPrecioModulo({ priceMxnMonthly: 129, priceMxnAnnual: 1549 });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /doce meses/);
});

test("tope de cordura en el mensual", () => {
  assert.equal(validarPrecioModulo({ priceMxnMonthly: PRECIO_MODULO_MAXIMO_MXN, priceMxnAnnual: null }).ok, true);
  assert.equal(validarPrecioModulo({ priceMxnMonthly: PRECIO_MODULO_MAXIMO_MXN + 1, priceMxnAnnual: null }).ok, false);
});

test("cuerpo que no es un objeto", () => {
  assert.equal(validarPrecioModulo(null).ok, false);
  assert.equal(validarPrecioModulo("129").ok, false);
});

test("descuento del anual: 129 → 1316 es 15 %", () => {
  assert.equal(descuentoAnualPct({ priceMxnMonthly: 129, priceMxnAnnual: 1316 }), 15);
  assert.equal(descuentoAnualPct({ priceMxnMonthly: 129, priceMxnAnnual: null }), null);
  assert.equal(descuentoAnualPct({ priceMxnMonthly: 129, priceMxnAnnual: 1548 }), null);
});

test("solo se edita lo que hoy se vende: Ortodoncia", () => {
  assert.equal(moduloEnVenta("orthodontics"), true);
  assert.equal(moduloEnVenta("endodontics"), false);
  assert.equal(moduloEnVenta(""), false);
});
