// Ortodoncia — Parte 7. Tests de comparación contra normas (H1/H4).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateAgainstNorms, getNormTable } from "../norms";
import type { CephMeasurements } from "../measurements";

const FULL: CephMeasurements = { SNA: 82, SNB: 80, ANB: 2, FMA: 25, IMPA: 90 };

describe("getNormTable", () => {
  it("MEXICAN sobreescribe solo ANB/IMPA, deja SNA/SNB/FMA sin dato", () => {
    const t = getNormTable("STEINER", "MEXICAN");
    assert.equal(t.ANB?.mean, 3);
    assert.equal(t.IMPA?.mean, 95);
    assert.equal(t.SNA, null);
    assert.equal(t.SNB, null);
    assert.equal(t.FMA, null);
  });

  it("STANDARD trae los 5 valores clásicos", () => {
    const t = getNormTable("STEINER", "STANDARD");
    assert.equal(t.SNA?.mean, 82);
    assert.equal(t.ANB?.mean, 2);
  });
});

describe("evaluateAgainstNorms", () => {
  it("valor igual a la media da interpretación normal", () => {
    const evals = evaluateAgainstNorms(FULL, "STEINER", "STANDARD");
    const anb = evals.find((e) => e.key === "ANB")!;
    assert.equal(anb.interpretation, "normal");
    assert.equal(anb.deviationSd, 0);
  });

  it("valor 2 SD por encima da 'aumentado'", () => {
    const measurements: CephMeasurements = { ...FULL, ANB: 6 }; // media 2, sd 2 → +2SD
    const evals = evaluateAgainstNorms(measurements, "STEINER", "STANDARD");
    const anb = evals.find((e) => e.key === "ANB")!;
    assert.equal(anb.interpretation, "aumentado");
    assert.equal(anb.deviationSd, 2);
  });

  it("valor por debajo de la media da 'disminuido'", () => {
    const measurements: CephMeasurements = { ...FULL, ANB: -3 };
    const evals = evaluateAgainstNorms(measurements, "STEINER", "STANDARD");
    const anb = evals.find((e) => e.key === "ANB")!;
    assert.equal(anb.interpretation, "disminuido");
  });

  it("medida null da 'sin-medida' sin reventar", () => {
    const measurements: CephMeasurements = { ...FULL, SNA: null };
    const evals = evaluateAgainstNorms(measurements, "STEINER", "STANDARD");
    const sna = evals.find((e) => e.key === "SNA")!;
    assert.equal(sna.interpretation, "sin-medida");
    assert.equal(sna.value, null);
  });

  it("norma mexicana sin dato (SNA) da 'sin-norma', no rompe ni inventa", () => {
    const evals = evaluateAgainstNorms(FULL, "STEINER", "MEXICAN");
    const sna = evals.find((e) => e.key === "SNA")!;
    assert.equal(sna.interpretation, "sin-norma");
    assert.equal(sna.norm, null);
    // Pero ANB sí tiene norma mexicana citada.
    const anb = evals.find((e) => e.key === "ANB")!;
    assert.equal(anb.norm?.mean, 3);
  });
});
