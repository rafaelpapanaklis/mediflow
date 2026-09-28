// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Tests de Ricketts.
// Puntos sintéticos, mismo criterio que `steiner.test.ts`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRickettsMeasurements } from "../ricketts";
import type { CephPoints } from "../../landmarks";

describe("computeRickettsMeasurements", () => {
  it("eje facial: 45° cuando Pt-Gn está a 45° de Ba-N", () => {
    const points: CephPoints = {
      BA: { x: 0, y: 0 },
      N: { x: 100, y: 0 },
      PT: { x: 0, y: 0 },
      GN: { x: 100, y: 100 },
    };
    assert.equal(computeRickettsMeasurements(points).FACIAL_AXIS, 45);
  });

  it("profundidad facial: 45° cuando N-Pog está a 45° de FH", () => {
    const points: CephPoints = {
      OR: { x: 0, y: 0 },
      PO: { x: 100, y: 0 },
      N: { x: 0, y: 0 },
      PG: { x: 100, y: 100 },
    };
    assert.equal(computeRickettsMeasurements(points).FACIAL_DEPTH, 45);
  });

  it("plano mandibular (Ricketts): 45° cuando Go-Gn está a 45° de FH", () => {
    const points: CephPoints = {
      OR: { x: 0, y: 0 },
      PO: { x: 100, y: 0 },
      GO: { x: 0, y: 0 },
      GN: { x: 100, y: 100 },
    };
    assert.equal(computeRickettsMeasurements(points).MANDIBULAR_PLANE_RICKETTS, 45);
  });

  it("convexidad: -3mm con calibración 10 px/mm", () => {
    const points: CephPoints = {
      N: { x: 0, y: 0 },
      PG: { x: 100, y: 0 },
      A: { x: 50, y: -30 },
    };
    assert.equal(computeRickettsMeasurements(points, 10).CONVEXITY_MM, -3);
  });

  it("labio superior/inferior a línea E, con calibración 10 px/mm", () => {
    const points: CephPoints = {
      PRN: { x: 0, y: 0 },
      POG_SOFT: { x: 100, y: 0 },
      LS: { x: 50, y: -40 },
      LI: { x: 50, y: -20 },
    };
    const m = computeRickettsMeasurements(points, 10);
    assert.equal(m.UPPER_LIP_E_MM, -4);
    assert.equal(m.LOWER_LIP_E_MM, -2);
  });

  it("sin calibración, las medidas en mm quedan null", () => {
    const points: CephPoints = {
      N: { x: 0, y: 0 },
      PG: { x: 100, y: 0 },
      A: { x: 50, y: -30 },
    };
    assert.equal(computeRickettsMeasurements(points).CONVEXITY_MM, null);
  });

  it("sin ningún punto, todo es null", () => {
    const m = computeRickettsMeasurements({});
    assert.deepEqual(m, {
      FACIAL_AXIS: null,
      FACIAL_DEPTH: null,
      MANDIBULAR_PLANE_RICKETTS: null,
      CONVEXITY_MM: null,
      UPPER_LIP_E_MM: null,
      LOWER_LIP_E_MM: null,
    });
  });
});
