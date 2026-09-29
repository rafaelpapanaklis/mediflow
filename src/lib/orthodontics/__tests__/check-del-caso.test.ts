/**
 * ws1-t10 — lo que la base admite en `orthodontic_treatment_plans` y cómo lo cumple el código.
 * Run: npx tsx --test src/lib/orthodontics/__tests__/check-del-caso.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COSTO_PROVISIONAL,
  acotarDuracion,
  costoParaGuardarPorControl,
  costoVisible,
  descripcionDelCosto,
  esViolacionDelCheckDelPlan,
  estimarCostoPorControl,
  mensajeDelCheckDelPlan,
  violacionesDelPlan,
} from "../check-del-caso";

test("la restricción vigente: duración 3..60 y costo > 0 (lo que rechazaba «Pago por control»)", () => {
  assert.deepEqual(violacionesDelPlan({ estimatedDurationMonths: 18, totalCostMxn: 30000 }), []);
  assert.deepEqual(violacionesDelPlan({ estimatedDurationMonths: 3, totalCostMxn: 0.01 }), []);
  assert.deepEqual(violacionesDelPlan({ estimatedDurationMonths: 60, totalCostMxn: "1" }), []);
  const cero = violacionesDelPlan({ estimatedDurationMonths: 4, totalCostMxn: 0 });
  assert.equal(cero.length, 1);
  assert.match(cero[0], /^orthodontic_treatment_plans_duration_chk: .*costo total \(0\)/);
  assert.equal(violacionesDelPlan({ estimatedDurationMonths: 2, totalCostMxn: 100 }).length, 1);
  assert.equal(violacionesDelPlan({ estimatedDurationMonths: 61, totalCostMxn: 100 }).length, 1);
  assert.equal(violacionesDelPlan({ estimatedDurationMonths: 2, totalCostMxn: 0 }).length, 2);
  // Decimal de Prisma (toString) y NaN.
  assert.deepEqual(violacionesDelPlan({ totalCostMxn: { toString: () => "1500.50" } }), []);
  assert.equal(violacionesDelPlan({ totalCostMxn: "abc" }).length, 1);
});

test("un caso abandonado pide fecha y motivo de 20+ caracteres", () => {
  assert.equal(violacionesDelPlan({ status: "DROPPED_OUT" }).length, 1);
  assert.equal(violacionesDelPlan({ status: "DROPPED_OUT", droppedOutAt: new Date(), droppedOutReason: "corto" }).length, 1);
  assert.deepEqual(violacionesDelPlan({ status: "DROPPED_OUT", droppedOutAt: new Date(), droppedOutReason: "El paciente se mudó de ciudad" }), []);
  assert.deepEqual(violacionesDelPlan({ status: "IN_PROGRESS" }), []);
});

test("la restricción corregida (sql/ortodoncia-costo-del-caso.sql): costo ≥ 0 y duración 1..120", () => {
  assert.deepEqual(violacionesDelPlan({ estimatedDurationMonths: 4, totalCostMxn: 0 }, "corregida"), []);
  assert.deepEqual(violacionesDelPlan({ estimatedDurationMonths: 1, totalCostMxn: 0 }, "corregida"), []);
  assert.deepEqual(violacionesDelPlan({ estimatedDurationMonths: 120, totalCostMxn: 5 }, "corregida"), []);
  assert.equal(violacionesDelPlan({ estimatedDurationMonths: 121, totalCostMxn: 5 }, "corregida").length, 1);
  assert.equal(violacionesDelPlan({ estimatedDurationMonths: 12, totalCostMxn: -1 }, "corregida").length, 1);
});

test("el SQL entregado dice lo mismo que la regla «corregida» (y es plano e idempotente)", () => {
  const sql = readFileSync(join(process.cwd(), "sql/ortodoncia-costo-del-caso.sql"), "utf8");
  const ejecutable = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(ejecutable, /DROP CONSTRAINT IF EXISTS "orthodontic_treatment_plans_duration_chk"/);
  assert.match(ejecutable, /CHECK \("estimatedDurationMonths" BETWEEN 1 AND 120 AND "totalCostMxn" >= 0\) NOT VALID/);
  assert.doesNotMatch(ejecutable, /\bDO\s+\$\$/, "el SQL Editor de Rafael no acepta bloques DO");
  assert.doesNotMatch(ejecutable, /DELETE|TRUNCATE|DROP TABLE|UPDATE\s/i, "no toca filas");
});

test("duración: acotada a 3..60 y el valor real se conserva para decirlo", () => {
  assert.deepEqual(acotarDuracion(18), { meses: 18, real: null });
  assert.deepEqual(acotarDuracion(75), { meses: 60, real: 75 });
  assert.deepEqual(acotarDuracion(2), { meses: 3, real: 2 });
  assert.deepEqual(acotarDuracion(null), { meses: 18, real: null });
  assert.deepEqual(acotarDuracion(NaN, 12), { meses: 12, real: null });
  assert.deepEqual(acotarDuracion(0), { meses: 18, real: null });
});

test("estimado: colocación + controles previstos × precio; sin eso, los cargos conocidos; sin nada, null", () => {
  assert.equal(estimarCostoPorControl({ colocacion: 3000, controlesPrevistos: 18, precioControl: 600 }), 13800);
  assert.equal(estimarCostoPorControl({ colocacion: 3000, importeDeControles: 2400 }), 5400);
  assert.equal(estimarCostoPorControl({ importeDeControles: 2400, controlesPrevistos: 99, precioControl: 1 }), 2400, "el importe ya sumado manda");
  assert.equal(estimarCostoPorControl({ colocacion: 3000, controlesPrevistos: 18, precioControl: null }), 3000, "sin precio de control, la colocación sola");
  assert.equal(estimarCostoPorControl({ colocacion: null, controlesPrevistos: 18, precioControl: 600 }), 10800);
  assert.equal(estimarCostoPorControl({ cargosConocidos: 7200 }), 7200);
  assert.equal(estimarCostoPorControl({ colocacion: 0, controlesPrevistos: 0, precioControl: 0, cargosConocidos: 0 }), null);
  assert.equal(estimarCostoPorControl({}), null);
  assert.equal(estimarCostoPorControl({ colocacion: 1000.005, controlesPrevistos: 3, precioControl: 333.333 }), 2000);
});

test("costo a guardar en «Pago por control»: lo escrito, si no el estimado, si no $1 provisional — nunca 0", () => {
  assert.deepEqual(costoParaGuardarPorControl({ escrito: 15000, estimado: 9000 }), { costo: 15000, origen: "escrito" });
  assert.deepEqual(costoParaGuardarPorControl({ escrito: 0, estimado: 9000 }), { costo: 9000, origen: "estimado" });
  assert.deepEqual(costoParaGuardarPorControl({ estimado: 9000 }), { costo: 9000, origen: "estimado" });
  assert.deepEqual(costoParaGuardarPorControl({ escrito: null, estimado: null }), { costo: COSTO_PROVISIONAL, origen: "provisional" });
  assert.deepEqual(costoParaGuardarPorControl({}), { costo: 1, origen: "provisional" });
  for (const a of [{}, { escrito: 0 }, { escrito: -5 }, { escrito: NaN, estimado: NaN }, { estimado: 0 }]) {
    assert.deepEqual(violacionesDelPlan({ estimatedDurationMonths: 12, totalCostMxn: costoParaGuardarPorControl(a).costo }), [], `cumple la base: ${JSON.stringify(a)}`);
  }
});

test("el $1 provisional no se enseña como precio", () => {
  assert.equal(costoVisible(COSTO_PROVISIONAL), null);
  assert.equal(costoVisible("1.00"), null);
  assert.equal(costoVisible(null), null);
  assert.equal(costoVisible(undefined), null);
  assert.equal(costoVisible(0), null);
  assert.equal(costoVisible(5400), 5400);
  assert.equal(costoVisible({ toString: () => "36000.00" }), 36000);
  assert.equal(descripcionDelCosto("PAGO_POR_CONTROL", 5400)?.estimado, true);
  assert.match(descripcionDelCosto("PAGO_POR_CONTROL", 5400)!.etiqueta, /estimado/i);
  assert.equal(descripcionDelCosto("PRECIO_TOTAL", 36000)?.estimado, false);
  assert.equal(descripcionDelCosto(null, 36000)?.etiqueta, "Costo total del tratamiento");
  assert.equal(descripcionDelCosto("PAGO_POR_CONTROL", 1), null);
});

test("el error de la base se reconoce por la restricción o por el 23514, no por cualquier fallo", () => {
  assert.equal(esViolacionDelCheckDelPlan({ code: "P2004", message: 'new row for relation "orthodontic_treatment_plans" violates check constraint "orthodontic_treatment_plans_duration_chk"' }), true);
  assert.equal(esViolacionDelCheckDelPlan({ message: "…orthodontic_treatment_plans_dropped_out_chk…" }), true);
  assert.equal(esViolacionDelCheckDelPlan({ meta: { code: "23514" }, message: 'violates check constraint on "orthodontic_treatment_plans"' }), true);
  assert.equal(esViolacionDelCheckDelPlan({ code: "23514", message: 'violates check constraint on "ortho_installments"' }), false, "otra tabla");
  assert.equal(esViolacionDelCheckDelPlan({ code: "P2002", message: "Unique constraint failed" }), false);
  assert.equal(esViolacionDelCheckDelPlan(null), false);
  assert.equal(esViolacionDelCheckDelPlan("boom"), false);
  assert.match(mensajeDelCheckDelPlan({ estimatedDurationMonths: 4, totalCostMxn: 0 }), /costo total \(0\) debe ser mayor que cero/);
  assert.match(mensajeDelCheckDelPlan({ estimatedDurationMonths: 4, totalCostMxn: 10 }), /restricción de la tabla/);
});
