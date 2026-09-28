// ronda 3 (ws1-t2) — H9: «Abrir plan de pago» / «Abrir factura de
// colocación/enganche» abría el editor de facturas EN BLANCO (sin
// conceptos, «Doctor: Sin asignar», total $0). Si alguien vuelve a
// desconectar el borrador del caso, estas pruebas fallan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { borradorInicialDelCaso } from "../borrador-factura";

test("PRECIO_TOTAL: un concepto con el precio del caso y el doctor tratante", () => {
  const b = borradorInicialDelCaso(
    { technique: "METAL_BRACKETS", totalCostMxn: 36000, treatingDoctorId: "doc-1" },
    false,
  );
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].unitPrice, 36000);
  assert.equal(b.items[0].quantity, 1);
  assert.match(b.items[0].name, /brackets metálicos/);
  assert.doesNotMatch(b.items[0].name, /[Cc]olocación/); // no es el texto de PAGO_POR_CONTROL
  assert.equal(b.doctorId, "doc-1");
});

test("PAGO_POR_CONTROL: el concepto deja claro que es SOLO la colocación/enganche", () => {
  const b = borradorInicialDelCaso(
    { technique: "CLEAR_ALIGNERS", totalCostMxn: 5000, treatingDoctorId: "doc-2" },
    true,
  );
  assert.match(b.items[0].name, /[Cc]olocación\/enganche/);
  assert.match(b.items[0].name, /alineadores transparentes/);
  assert.equal(b.items[0].unitPrice, 5000);
  assert.equal(b.doctorId, "doc-2");
});

test("sin doctor tratante: doctorId vacío (el editor lo trata como «sin elegir», no truena)", () => {
  const b = borradorInicialDelCaso({ technique: "METAL_BRACKETS", totalCostMxn: 1000, treatingDoctorId: null }, false);
  assert.equal(b.doctorId, "");
});

test("costo negativo o inválido nunca produce un precio inicial negativo", () => {
  const b = borradorInicialDelCaso({ technique: "METAL_BRACKETS", totalCostMxn: -50, treatingDoctorId: null }, false);
  assert.equal(b.items[0].unitPrice, 0);
});

test("nunca trae condiciones ni descuento inventados: el editor arranca con los defaults de siempre", () => {
  const b = borradorInicialDelCaso({ technique: "METAL_BRACKETS", totalCostMxn: 1000, treatingDoctorId: null }, false);
  assert.equal(b.condiciones, null);
  assert.equal(b.descuento, 0);
  assert.equal(b.taxRate, null);
});
