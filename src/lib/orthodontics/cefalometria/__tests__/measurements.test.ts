// Ortodoncia — Parte 7. Tests de SNA/SNB/ANB/FMA/IMPA.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCephMeasurements } from "../measurements";
import type { CephPoints } from "../landmarks";

// Puntos sintéticos construidos a mano para dar ángulos exactos y fáciles
// de verificar, no un caso clínico real.
function fullTracing(): CephPoints {
  return {
    S: { x: 0, y: 0 },
    N: { x: 100, y: 0 },
    A: { x: 200, y: 50 }, // SNA = ángulo en N entre N→S y N→A
    B: { x: 200, y: 30 },
    OR: { x: 0, y: 100 },
    PO: { x: 100, y: 100 }, // Po→Or apunta en -x
    GO: { x: 100, y: 200 },
    ME: { x: 0, y: 200 }, // Go→Me también apunta en -x: mismo sentido que Po→Or → FMA=0
    L1_TIP: { x: 50, y: 250 },
    L1_APEX: { x: 50, y: 150 }, // eje vertical → perpendicular al plano mandibular → IMPA=90
  };
}

describe("computeCephMeasurements", () => {
  it("con todos los puntos calcula las 5 medidas", () => {
    const m = computeCephMeasurements(fullTracing());
    assert.notEqual(m.SNA, null);
    assert.notEqual(m.SNB, null);
    assert.notEqual(m.ANB, null);
    assert.notEqual(m.FMA, null);
    assert.notEqual(m.IMPA, null);
  });

  it("ANB = SNA - SNB", () => {
    const m = computeCephMeasurements(fullTracing());
    assert.equal(m.ANB, Math.round((m.SNA! - m.SNB!) * 10) / 10);
  });

  it("FMA = 0 cuando Frankfort y plano mandibular son paralelos", () => {
    const m = computeCephMeasurements(fullTracing());
    assert.equal(m.FMA, 0);
  });

  it("IMPA = 90 cuando el eje del incisivo es perpendicular al plano mandibular", () => {
    const m = computeCephMeasurements(fullTracing());
    assert.equal(m.IMPA, 90);
  });

  it("faltando un punto, las medidas que dependen de él quedan en null", () => {
    const points = fullTracing();
    delete points.A;
    const m = computeCephMeasurements(points);
    assert.equal(m.SNA, null);
    assert.equal(m.ANB, null);
    // SNB no depende de A, sigue calculándose.
    assert.notEqual(m.SNB, null);
    // FMA/IMPA tampoco dependen de A.
    assert.notEqual(m.FMA, null);
    assert.notEqual(m.IMPA, null);
  });

  it("sin ningún punto, todo es null", () => {
    const m = computeCephMeasurements({});
    assert.deepEqual(m, { SNA: null, SNB: null, ANB: null, FMA: null, IMPA: null });
  });
});
