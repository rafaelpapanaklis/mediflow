// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Tests de
// calibración a milímetros.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCalibrationPxPerMm, mmToPx } from "../calibration";

describe("computeCalibrationPxPerMm", () => {
  it("100px = 10mm conocidos → 10 px/mm", () => {
    const px = computeCalibrationPxPerMm({
      points: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
      knownDistanceMm: 10,
    });
    assert.equal(px, 10);
  });

  it("null sin puntos", () => {
    assert.equal(computeCalibrationPxPerMm({ points: null, knownDistanceMm: 10 }), null);
  });

  it("null sin distancia conocida (0, negativa o null)", () => {
    const points = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
    assert.equal(computeCalibrationPxPerMm({ points, knownDistanceMm: 0 }), null);
    assert.equal(computeCalibrationPxPerMm({ points, knownDistanceMm: -5 }), null);
    assert.equal(computeCalibrationPxPerMm({ points, knownDistanceMm: null }), null);
  });

  it("null si los dos clics cayeron en el mismo sitio (0 px)", () => {
    const points = { a: { x: 5, y: 5 }, b: { x: 5, y: 5 } };
    assert.equal(computeCalibrationPxPerMm({ points, knownDistanceMm: 10 }), null);
  });
});

describe("mmToPx", () => {
  it("convierte con calibración válida", () => {
    assert.equal(mmToPx(10, 10), 100);
  });

  it("null sin calibración", () => {
    assert.equal(mmToPx(10, 0), null);
  });
});
