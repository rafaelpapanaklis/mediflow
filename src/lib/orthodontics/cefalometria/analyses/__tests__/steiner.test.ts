// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Tests de las
// medidas extra de Steiner. Puntos sintéticos elegidos para dar ángulos
// exactos y fáciles de verificar a mano, no un caso clínico real (mismo
// criterio que `../../__tests__/measurements.test.ts`).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSteinerExtras } from "../steiner";
import type { CephPoints } from "../../landmarks";

describe("computeSteinerExtras", () => {
  it("SN-GoGn: 45° cuando Go-Gn está a 45° de SN", () => {
    const points: CephPoints = {
      S: { x: 0, y: 0 },
      N: { x: 100, y: 0 },
      GO: { x: 0, y: 0 },
      GN: { x: 100, y: 100 },
    };
    assert.equal(computeSteinerExtras(points).SN_GOGN, 45);
  });

  it("U1-NA: 90° y -50px cuando el incisivo es perpendicular a NA", () => {
    const points: CephPoints = {
      N: { x: 0, y: 0 },
      A: { x: 100, y: 0 },
      U1_APEX: { x: 50, y: 0 },
      U1_TIP: { x: 50, y: -50 },
    };
    const m = computeSteinerExtras(points);
    assert.equal(m.U1_NA_DEG, 90);
    // Sin calibración: el ángulo se calcula, el mm queda null.
    assert.equal(m.U1_NA_MM, null);
  });

  it("U1-NA en mm, con calibración de 10 px/mm", () => {
    const points: CephPoints = {
      N: { x: 0, y: 0 },
      A: { x: 100, y: 0 },
      U1_TIP: { x: 50, y: -50 },
    };
    const m = computeSteinerExtras(points, 10);
    assert.equal(m.U1_NA_MM, -5);
  });

  it("L1-NB: 90° y 3mm (calibración 10 px/mm)", () => {
    const points: CephPoints = {
      N: { x: 0, y: 0 },
      B: { x: 100, y: 0 },
      L1_APEX: { x: 50, y: 0 },
      L1_TIP: { x: 50, y: 30 },
    };
    const m = computeSteinerExtras(points, 10);
    assert.equal(m.L1_NB_DEG, 90);
    assert.equal(m.L1_NB_MM, 3);
  });

  it("ángulo interincisal entre dos ejes diagonales perpendiculares entre sí", () => {
    const points: CephPoints = {
      U1_APEX: { x: 0, y: 0 },
      U1_TIP: { x: 10, y: -10 },
      L1_APEX: { x: 0, y: 0 },
      L1_TIP: { x: -10, y: -10 },
    };
    assert.equal(computeSteinerExtras(points).INTERINCISAL, 90);
  });

  it("plano oclusal a SN: 45°", () => {
    const points: CephPoints = {
      OCC_ANT: { x: 0, y: 0 },
      OCC_POST: { x: 100, y: 0 },
      S: { x: 0, y: 0 },
      N: { x: 100, y: 100 },
    };
    assert.equal(computeSteinerExtras(points).OCCLUSAL_SN, 45);
  });

  it("sin ningún punto, todo es null", () => {
    const m = computeSteinerExtras({});
    assert.deepEqual(m, {
      SN_GOGN: null,
      U1_NA_DEG: null,
      U1_NA_MM: null,
      L1_NB_DEG: null,
      L1_NB_MM: null,
      INTERINCISAL: null,
      OCCLUSAL_SN: null,
    });
  });

  it("faltando el punto A, solo las medidas que dependen de él quedan en null", () => {
    const points: CephPoints = {
      S: { x: 0, y: 0 },
      N: { x: 100, y: 0 },
      GO: { x: 0, y: 0 },
      GN: { x: 100, y: 100 },
      // Sin A: U1_NA_DEG/MM deben quedar null; SN_GOGN sigue calculándose.
    };
    const m = computeSteinerExtras(points, 10);
    assert.equal(m.SN_GOGN, 45);
    assert.equal(m.U1_NA_DEG, null);
    assert.equal(m.U1_NA_MM, null);
  });
});
