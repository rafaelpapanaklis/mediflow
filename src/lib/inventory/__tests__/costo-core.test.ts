import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sumarValorInventario,
  validarLineaCompra,
  montoTotalCompra,
  validarDescuentoInsumo,
} from "../costo-core";

test("sumarValorInventario: Σ unitCost × quantity, y 0 cuenta (no desaparece del total)", () => {
  assert.equal(sumarValorInventario([{ unitCost: 10, quantity: 3 }, { unitCost: 5, quantity: 2 }]), 40);
  assert.equal(sumarValorInventario([{ unitCost: 0, quantity: 100 }]), 0);
  assert.equal(sumarValorInventario([]), 0);
});

test("validarLineaCompra: cantidad entera > 0", () => {
  assert.equal(validarLineaCompra({ quantity: 5, unitCost: 10 }), null);
  assert.ok(validarLineaCompra({ quantity: 0, unitCost: 10 }));
  assert.ok(validarLineaCompra({ quantity: -3, unitCost: 10 }));
  assert.ok(validarLineaCompra({ quantity: 1.5, unitCost: 10 }));
});

test("validarLineaCompra: costo unitario no negativo, 0 es válido", () => {
  assert.equal(validarLineaCompra({ quantity: 1, unitCost: 0 }), null);
  assert.ok(validarLineaCompra({ quantity: 1, unitCost: -1 }));
  assert.ok(validarLineaCompra({ quantity: 1, unitCost: NaN }));
});

test("montoTotalCompra: suma de líneas", () => {
  assert.equal(montoTotalCompra([{ quantity: 2, unitCost: 100 }, { quantity: 3, unitCost: 500 }]), 1700);
  assert.equal(montoTotalCompra([]), 0);
});

test("validarDescuentoInsumo: rechaza cantidad negativa o cero (bug: restaba y subía el stock)", () => {
  assert.ok(validarDescuentoInsumo(10, -5));
  assert.ok(validarDescuentoInsumo(10, 0));
});

test("validarDescuentoInsumo: rechaza exceder lo disponible; nunca deja existencias negativas", () => {
  assert.ok(validarDescuentoInsumo(3, 5));
  assert.equal(validarDescuentoInsumo(5, 5), null);
  assert.equal(validarDescuentoInsumo(5, 3), null);
});
