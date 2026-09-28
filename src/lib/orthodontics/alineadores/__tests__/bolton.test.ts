// Ortodoncia — Parte 7. Tests de Bolton y espacio de arco (H9/H10).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeArchSpaceDiscrepancy, computeBolton } from "../bolton";

// Anchos sintéticos: 7mm cada diente superior anterior (6*7=42), 6mm cada
// inferior anterior (6*6=36) → ratio anterior = 36/42*100 = 85.7%.
function widthsAnterior(): Record<number, number> {
  return { 13: 7, 12: 7, 11: 7, 21: 7, 22: 7, 23: 7, 43: 6, 42: 6, 41: 6, 31: 6, 32: 6, 33: 6 };
}

describe("computeBolton", () => {
  it("calcula el ratio anterior con los 12 dientes marcados", () => {
    const r = computeBolton(widthsAnterior());
    assert.equal(r.anteriorRatio, 85.7);
    assert.equal(r.missingTeeth.length > 0, true); // faltan los 12 posteriores para el ratio total
    assert.equal(r.overallRatio, null);
  });

  it("discrepancia positiva cuando el ratio supera el ideal (exceso mandibular)", () => {
    const r = computeBolton(widthsAnterior());
    // 85.7% > 77.2% ideal → sobra material mandibular anterior.
    assert.equal(r.anteriorDiscrepancyMm! > 0, true);
  });

  it("sin ningún ancho, todo null y todos los dientes en missingTeeth", () => {
    const r = computeBolton({});
    assert.equal(r.anteriorRatio, null);
    assert.equal(r.overallRatio, null);
    assert.equal(r.missingTeeth.length, 24);
  });

  it("un solo diente faltante tumba el ratio anterior completo (no lo aproxima)", () => {
    const w = widthsAnterior();
    delete (w as Record<number, number | undefined>)[11];
    const r = computeBolton(w);
    assert.equal(r.anteriorRatio, null);
    assert.deepEqual(r.missingTeeth.filter((t) => t === 11), [11]);
  });
});

describe("computeArchSpaceDiscrepancy", () => {
  it("apiñamiento: espacio disponible menor a la suma de anchos", () => {
    const r = computeArchSpaceDiscrepancy(30, { 11: 8, 21: 8, 22: 8, 12: 8 }, [11, 21, 12, 22]);
    assert.equal(r.requiredMm, 32);
    assert.equal(r.discrepancyMm, -2);
  });

  it("espaciado: sobra espacio", () => {
    const r = computeArchSpaceDiscrepancy(40, { 11: 8, 21: 8 }, [11, 21]);
    assert.equal(r.discrepancyMm, 24);
  });

  it("reporta qué dientes faltan por medir", () => {
    const r = computeArchSpaceDiscrepancy(30, { 11: 8 }, [11, 21]);
    assert.deepEqual(r.missingTeeth, [21]);
  });
});
