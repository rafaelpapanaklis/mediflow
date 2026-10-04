/**
 * El descuento de factura en $ o en % (pedido de Rafael, 4-oct-2026) — ws1-t5.
 * Run: npm run test:descuento-pesos
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { calcularDescuento, convertirEntrada, leerNumero } from "@/lib/dinero/descuento-pesos";

const RAIZ = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

test("10 % de $500 = $50.00 (se guarda en pesos)", () => {
  assert.deepEqual(calcularDescuento("porcentaje", "10", 500), { pesos: 50, porcentaje: 10, recortado: false });
});

test("redondeo a centavos: 15 % de $333.33 = $50.00 (49.9995); 33.333 % de $100 = $33.33", () => {
  assert.equal(calcularDescuento("porcentaje", "15", 333.33).pesos, 50);
  assert.equal(calcularDescuento("porcentaje", "33.333", 100).pesos, 33.33);
  assert.equal(calcularDescuento("pesos", "12.345", 100).pesos, 12.35);
});

test("nunca más que el subtotal: 120 % o $700 sobre $500 → $500 y avisa", () => {
  assert.deepEqual(calcularDescuento("porcentaje", "120", 500), { pesos: 500, porcentaje: 100, recortado: true });
  assert.deepEqual(calcularDescuento("pesos", "700", 500), { pesos: 500, porcentaje: 100, recortado: true });
});

test("sin tope de porcentaje (decisión de Rafael): 90 % pasa tal cual", () => {
  assert.deepEqual(calcularDescuento("porcentaje", "90", 1_000), { pesos: 900, porcentaje: 90, recortado: false });
});

test("en pesos: $50 de $500 es el 10 %; vacío = 0; basura o negativo = inválido; comas y $ se aceptan", () => {
  assert.deepEqual(calcularDescuento("pesos", "50", 500), { pesos: 50, porcentaje: 10, recortado: false });
  assert.equal(calcularDescuento("pesos", "", 500).pesos, 0);
  assert.equal(calcularDescuento("pesos", "abc", 500).pesos, null);
  assert.equal(calcularDescuento("pesos", "-5", 500).pesos, null);
  assert.equal(leerNumero("$1,250.50"), 1250.5);
  assert.equal(calcularDescuento("porcentaje", "10", 0).pesos, 0, "sin subtotal no hay descuento");
});

test("cambiar de modo no cambia el descuento: $50 ↔ 10 % sobre $500", () => {
  assert.equal(convertirEntrada("pesos", "porcentaje", "50", 500), "10");
  assert.equal(convertirEntrada("porcentaje", "pesos", "10", 500), "50.00");
  assert.equal(convertirEntrada("pesos", "porcentaje", "", 500), "");
});

test("«Registrar pago» y «Aplicar descuento» usan el campo $ / %", () => {
  const seccion = leer("src/components/dashboard/factura-un-popup/seccion-cobro.tsx");
  assert.match(seccion, /export function CampoDescuento\(/);
  assert.match(seccion, /<CampoDescuento\s/);
  assert.match(leer("src/components/dashboard/billing/invoice-detail-modal.tsx"), /<CampoDescuento\s/);
});
