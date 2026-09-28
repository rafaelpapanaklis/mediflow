// Ortodoncia — Ola 1 (ws1-t1 · Cobro): F9 (descuentos) y F10 (recargo por
// atraso). Puro: sin base, sin fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularDescuento,
  calcularRecargo,
  configDeCobroPorDefecto,
  diasEntre,
  type ConfigRecargoPorAtraso,
} from "../cobro/reglas";

test("configDeCobroPorDefecto: recargo apagado, sin reglas de descuento", () => {
  const c = configDeCobroPorDefecto();
  assert.equal(c.lateFee.activo, false);
  assert.deepEqual(c.discountRules, []);
});

test("calcularDescuento: porcentaje normal sobre el total, en centavos exactos", () => {
  assert.equal(calcularDescuento(10, 32000), 3200);
  assert.equal(calcularDescuento(15, 1000), 150);
});

test("calcularDescuento: un porcentaje fuera de [0,100] se acota, nunca da negativo ni más que el total", () => {
  assert.equal(calcularDescuento(-5, 1000), 0);
  assert.equal(calcularDescuento(150, 1000), 1000);
});

const recargoPct: ConfigRecargoPorAtraso = { activo: true, tipo: "PCT", valor: 10, diasDeGracia: 5 };
const recargoFijo: ConfigRecargoPorAtraso = { activo: true, tipo: "FIJO", valor: 50, diasDeGracia: 5 };
const recargoApagado: ConfigRecargoPorAtraso = { activo: false, tipo: "PCT", valor: 10, diasDeGracia: 5 };

test("calcularRecargo: apagado (default de la clínica) nunca cobra nada", () => {
  assert.equal(calcularRecargo(recargoApagado, 1000, 30), 0);
});

test("calcularRecargo: dentro de los días de gracia, nada", () => {
  assert.equal(calcularRecargo(recargoPct, 1000, 5), 0);
  assert.equal(calcularRecargo(recargoPct, 1000, 0), 0);
});

test("calcularRecargo: pasados los días de gracia, aplica el porcentaje sobre la cuota", () => {
  assert.equal(calcularRecargo(recargoPct, 1000, 6), 100);
  assert.equal(calcularRecargo(recargoPct, 1000, 40), 100);
});

test("calcularRecargo: tipo FIJO ignora el importe de la cuota", () => {
  assert.equal(calcularRecargo(recargoFijo, 1000, 10), 50);
  assert.equal(calcularRecargo(recargoFijo, 50000, 10), 50);
});

test("calcularRecargo: una cuota ya saldada (importe 0) no genera recargo", () => {
  assert.equal(calcularRecargo(recargoPct, 0, 40), 0);
});

test("diasEntre: cuenta días naturales, negativo si b es anterior a a", () => {
  assert.equal(diasEntre("2026-01-01", "2026-01-11"), 10);
  assert.equal(diasEntre("2026-01-11", "2026-01-01"), -10);
  assert.equal(diasEntre("2026-01-01", "2026-01-01"), 0);
});
