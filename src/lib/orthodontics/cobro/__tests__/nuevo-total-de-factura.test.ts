// ws1-t12 — cambiar el costo de un caso con factura: cómo queda la factura para llegar al total nuevo.
// Correr: npm run test:orto-plan-detalle
import { test } from "node:test";
import assert from "node:assert/strict";
import { propuestaParaNuevoTotal } from "../nuevo-total-de-factura";

const F = (extra: object = {}) => ({ items: [{ name: "Tratamiento de ortodoncia", quantity: 1, unitPrice: 30000 }], discount: 0, taxRate: 16, taxIncluded: true, ...extra });

test("subir el costo agrega una línea «Ajuste de precio»", () => {
  const p = propuestaParaNuevoTotal(F(), 34000);
  assert.equal(p.total, 34000);
  assert.equal(p.items.length, 2);
  assert.equal((p.items[1] as { unitPrice: number }).unitPrice, 4000);
  assert.equal(p.discount, 0);
});

test("bajar el costo se representa como descuento y no borra conceptos", () => {
  const p = propuestaParaNuevoTotal(F(), 27500);
  assert.equal(p.total, 27500);
  assert.equal(p.items.length, 1);
  assert.equal(p.discount, 2500);
});

test("un ajuste de una edición anterior se recalcula, no se acumula", () => {
  const conAjuste = F({ items: [{ name: "Tratamiento", quantity: 1, unitPrice: 30000 }, { description: "Ajuste de precio", quantity: 1, unitPrice: 4000, total: 4000, _priceAdjust: true }] });
  const p = propuestaParaNuevoTotal(conAjuste, 35000);
  assert.equal(p.total, 35000);
  assert.equal(p.items.length, 2);
  assert.equal((p.items[1] as { unitPrice: number }).unitPrice, 5000);
  const igual = propuestaParaNuevoTotal(conAjuste, 30000);
  assert.equal(igual.items.length, 1);
  assert.equal(igual.total, 30000);
});

test("con IVA agregado, el total capturado es el bruto", () => {
  const p = propuestaParaNuevoTotal(F({ taxIncluded: false }), 34800);
  assert.equal(p.total, 34800);
});
