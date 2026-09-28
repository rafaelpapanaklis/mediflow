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

// ws1-t4 #76: en «Pago por control» la factura es SOLO la colocación. Con el
// costo del tratamiento entero el paciente quedaba debiendo $30,000 de
// colocación más cada control.
test("PAGO_POR_CONTROL: el precio es el de «Colocación de aparatología», NO el costo del tratamiento", () => {
  const b = borradorInicialDelCaso({ technique: "METAL_BRACKETS", totalCostMxn: 30000, treatingDoctorId: null }, true, 3000);
  assert.equal(b.items[0].unitPrice, 3000);
});

test("PAGO_POR_CONTROL sin precio de catálogo arranca en $0, nunca en el costo total", () => {
  const caso = { technique: "METAL_BRACKETS" as const, totalCostMxn: 30000, treatingDoctorId: null };
  assert.equal(borradorInicialDelCaso(caso, true).items[0].unitPrice, 0);
  assert.equal(borradorInicialDelCaso(caso, true, null).items[0].unitPrice, 0);
});

test("PRECIO_TOTAL ignora el precio de la colocación", () => {
  const b = borradorInicialDelCaso({ technique: "METAL_BRACKETS", totalCostMxn: 30000, treatingDoctorId: null }, false, 3000);
  assert.equal(b.items[0].unitPrice, 30000);
});

test("elegirPrecioColocacion: activa gana, apagada o sin precio es null", async () => {
  const { elegirPrecioColocacion } = await import("../../catalog-procedures");
  assert.equal(elegirPrecioColocacion([
    { name: "Colocación de aparatología", basePrice: 2500, isActive: false },
    { name: "Colocación de aparatología", basePrice: 3200, isActive: true },
  ]), 3200);
  assert.equal(elegirPrecioColocacion([{ name: "Colocación de aparatología", basePrice: 2500, isActive: false }]), null);
  assert.equal(elegirPrecioColocacion([{ name: "Colocación de aparatología", basePrice: 0, isActive: true }]), null);
  assert.equal(elegirPrecioColocacion([]), null);
});
