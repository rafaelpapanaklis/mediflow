// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Tests de
// McNamara. Puntos sintéticos, mismo criterio que `steiner.test.ts`.
// TODAS las medidas de McNamara son en mm — sin calibración, todo sale
// null (comprobado abajo).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeMcNamaraMeasurements } from "../mcnamara";
import type { CephPoints } from "../../landmarks";

// FH horizontal (Or→Po en +x) para que la perpendicular por N sea una
// vertical simple — mismo truco que `geometria-plana.test.ts`.
const FH: CephPoints = { OR: { x: 0, y: 100 }, PO: { x: 100, y: 100 }, N: { x: 50, y: 0 } };

describe("computeMcNamaraMeasurements", () => {
  it("sin calibración, todo es null", () => {
    const points: CephPoints = { ...FH, A: { x: 80, y: 40 } };
    const m = computeMcNamaraMeasurements(points); // sin pixelsPerMm
    assert.deepEqual(m, {
      A_TO_NPERP_MM: null,
      PG_TO_NPERP_MM: null,
      CO_A_MM: null,
      CO_GN_MM: null,
      MAXMAND_DIFFERENTIAL_MM: null,
      LOWER_FACE_HEIGHT_MM: null,
    });
  });

  it("A y Pog a N-perpendicular, con calibración 10 px/mm", () => {
    const points: CephPoints = { ...FH, A: { x: 80, y: 40 }, PG: { x: 20, y: 40 } };
    const m = computeMcNamaraMeasurements(points, 10);
    assert.equal(m.A_TO_NPERP_MM, -3); // A cae 30px a la derecha de la vertical por N
    assert.equal(m.PG_TO_NPERP_MM, 3); // Pog cae 30px a la izquierda
  });

  it("Co-A, Co-Gn y el diferencial maxilomandibular", () => {
    const points: CephPoints = {
      CO: { x: 80, y: -10 },
      A: { x: 80, y: 40 }, // distancia 50 → 5mm
      GN: { x: 80, y: 90 }, // distancia 100 → 10mm
    };
    const m = computeMcNamaraMeasurements(points, 10);
    assert.equal(m.CO_A_MM, 5);
    assert.equal(m.CO_GN_MM, 10);
    assert.equal(m.MAXMAND_DIFFERENTIAL_MM, 5);
  });

  it("altura facial anteroinferior (ANS-Me)", () => {
    const points: CephPoints = { ANS: { x: 0, y: 0 }, ME: { x: 0, y: 60 } };
    assert.equal(computeMcNamaraMeasurements(points, 10).LOWER_FACE_HEIGHT_MM, 6);
  });

  it("diferencial null si falta Co-A o Co-Gn", () => {
    const points: CephPoints = { CO: { x: 0, y: 0 }, A: { x: 50, y: 0 } };
    const m = computeMcNamaraMeasurements(points, 10);
    assert.notEqual(m.CO_A_MM, null);
    assert.equal(m.CO_GN_MM, null);
    assert.equal(m.MAXMAND_DIFFERENTIAL_MM, null);
  });
});
