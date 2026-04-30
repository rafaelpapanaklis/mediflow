// Pediatrics — tests para Frankl/Venham + detectRegression. Spec: §4.A.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FRANKL_LABELS,
  VENHAM_LABELS,
  detectRegression,
  isFranklValue,
  isVenhamValue,
} from "../frankl";

describe("FRANKL_LABELS / VENHAM_LABELS", () => {
  it("Frankl tiene 4 niveles", () => {
    assert.equal(Object.keys(FRANKL_LABELS).length, 4);
  });

  it("Venham tiene 6 niveles (0-5)", () => {
    assert.equal(Object.keys(VENHAM_LABELS).length, 6);
  });
});

describe("isFranklValue / isVenhamValue", () => {
  it("acepta valores válidos de Frankl", () => {
    for (const v of [1, 2, 3, 4]) assert.equal(isFranklValue(v), true);
  });

  it("rechaza valores inválidos de Frankl", () => {
    for (const v of [0, 5, -1, 1.5]) assert.equal(isFranklValue(v), false);
  });

  it("acepta valores válidos de Venham 0-5", () => {
    for (const v of [0, 1, 2, 3, 4, 5]) assert.equal(isVenhamValue(v), true);
  });

  it("rechaza Venham fuera de rango o no entero", () => {
    for (const v of [-1, 6, 2.5]) assert.equal(isVenhamValue(v), false);
  });
});

describe("detectRegression", () => {
  it("Mateo: 2 visitas (Frankl 2 -> 3) sin regresión", () => {
    const result = detectRegression([
      { value: 2, date: new Date("2026-01-15") },
      { value: 3, date: new Date("2026-04-15") },
    ]);
    assert.equal(result.detected, false);
    assert.equal(result.severity, "none");
  });

  it("regresión severa (4 -> 1) detectada", () => {
    const result = detectRegression([
      { value: 4, date: new Date("2026-01-15") },
      { value: 4, date: new Date("2026-02-15") },
      { value: 1, date: new Date("2026-04-15") },
    ]);
    assert.equal(result.detected, true);
    assert.equal(result.severity, "severe");
  });

  it("regresión leve (3,3 -> 2) detectada como mild", () => {
    const result = detectRegression([
      { value: 3, date: new Date("2026-01-15") },
      { value: 3, date: new Date("2026-02-15") },
      { value: 2, date: new Date("2026-04-15") },
    ]);
    assert.equal(result.detected, true);
    assert.equal(result.severity, "mild");
  });

  it("primera visita no detecta regresión (no hay con qué comparar)", () => {
    const result = detectRegression([{ value: 2, date: new Date("2026-04-15") }]);
    assert.equal(result.detected, false);
  });

  it("mejoría (Frankl sube) no es regresión", () => {
    const result = detectRegression([
      { value: 1, date: new Date("2026-01-15") },
      { value: 2, date: new Date("2026-02-15") },
      { value: 4, date: new Date("2026-04-15") },
    ]);
    assert.equal(result.detected, false);
  });
});
