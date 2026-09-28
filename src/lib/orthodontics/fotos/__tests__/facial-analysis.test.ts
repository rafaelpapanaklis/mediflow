// Ortodoncia — Parte 7. Tests de línea E, ángulo nasolabial y línea media (H5).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeELine, computeMidlineDeviation, computeNasolabialAngle } from "../facial-analysis";
import type { FacialPoints } from "../landmarks";

describe("computeELine", () => {
  it("labio sobre la línea E da distancia 0", () => {
    const points: FacialPoints = {
      PRONASALE: { x: 0, y: 0 },
      SOFT_POGONION: { x: 0, y: 100 },
      LABRALE_SUPERIUS: { x: 0, y: 50 },
    };
    const r = computeELine(points);
    assert.equal(r.upperLipPx, 0);
  });

  it("labios a lados opuestos dan signos opuestos", () => {
    const points: FacialPoints = {
      PRONASALE: { x: 0, y: 0 },
      SOFT_POGONION: { x: 0, y: 100 },
      LABRALE_SUPERIUS: { x: -5, y: 50 },
      LABRALE_INFERIUS: { x: 5, y: 50 },
    };
    const r = computeELine(points);
    assert.equal(Math.sign(r.upperLipPx!), -Math.sign(r.lowerLipPx!));
  });

  it("con calibración devuelve mm además de px", () => {
    const points: FacialPoints = {
      PRONASALE: { x: 0, y: 0 },
      SOFT_POGONION: { x: 0, y: 100 },
      LABRALE_SUPERIUS: { x: 10, y: 50 },
    };
    const r = computeELine(points, 5); // 5 px/mm
    assert.equal(Math.abs(r.upperLipPx!), 10);
    assert.equal(Math.abs(r.upperLipMm!), 2);
  });

  it("faltando pronasale/pogonion, todo null (no revienta)", () => {
    const r = computeELine({});
    assert.deepEqual(r, { upperLipPx: null, lowerLipPx: null, upperLipMm: null, lowerLipMm: null });
  });
});

describe("computeNasolabialAngle", () => {
  it("ángulo recto entre columela y labio superior perpendiculares", () => {
    const points: FacialPoints = {
      SUBNASALE: { x: 0, y: 0 },
      COLUMELLA: { x: 0, y: -10 },
      LABRALE_SUPERIUS: { x: 10, y: 0 },
    };
    assert.equal(computeNasolabialAngle(points), 90);
  });

  it("null si falta algún punto", () => {
    assert.equal(computeNasolabialAngle({ SUBNASALE: { x: 0, y: 0 } }), null);
  });
});

describe("computeMidlineDeviation", () => {
  it("línea dental sobre la línea media facial → desviación 0", () => {
    const points: FacialPoints = {
      GLABELLA: { x: 50, y: 0 },
      MENTON_SOFT: { x: 50, y: 200 },
      DENTAL_MIDLINE: { x: 50, y: 150 },
    };
    const r = computeMidlineDeviation(points);
    assert.equal(r.deviationPx, 0);
  });

  it("desviada 4px con calibración de 2px/mm da 2mm", () => {
    const points: FacialPoints = {
      GLABELLA: { x: 50, y: 0 },
      MENTON_SOFT: { x: 50, y: 200 },
      DENTAL_MIDLINE: { x: 54, y: 150 },
    };
    const r = computeMidlineDeviation(points, 2);
    assert.equal(Math.abs(r.deviationPx!), 4);
    assert.equal(r.deviationMm, 2);
  });
});
