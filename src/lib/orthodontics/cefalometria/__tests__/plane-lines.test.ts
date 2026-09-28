// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Tests de
// `plane-lines.ts`: fuente única de qué puntos forman cada plano.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { availableCephPlanes, resolveCephPlane } from "../plane-lines";
import type { CephPoints } from "../landmarks";

const FULL: CephPoints = {
  S: { x: 0, y: 0 },
  N: { x: 100, y: 0 },
  A: { x: 200, y: 0 },
  B: { x: 200, y: 20 },
  OR: { x: 0, y: 100 },
  PO: { x: 100, y: 100 },
  GO: { x: 0, y: 200 },
  ME: { x: 0, y: 250 },
  GN: { x: 50, y: 250 },
  PG: { x: 60, y: 240 },
  ANS: { x: 10, y: 10 },
  PNS: { x: 90, y: 10 },
  OCC_ANT: { x: 10, y: 120 },
  OCC_POST: { x: 90, y: 120 },
  PRN: { x: -50, y: 50 },
  POG_SOFT: { x: 60, y: 260 },
  U1_APEX: { x: 30, y: 60 },
  U1_TIP: { x: 30, y: 130 },
  L1_APEX: { x: 40, y: 220 },
  L1_TIP: { x: 40, y: 150 },
  BA: { x: -20, y: -20 },
  PT: { x: -10, y: 50 },
};

describe("resolveCephPlane", () => {
  it("resuelve los 14 planos con un trazado completo", () => {
    for (const id of [
      "SN",
      "FH",
      "MANDIBULAR_GO_ME",
      "MANDIBULAR_GO_GN",
      "PALATAL",
      "OCCLUSAL",
      "NA",
      "NB",
      "N_POG",
      "E_LINE",
      "U1_AXIS",
      "L1_AXIS",
      "BA_N",
      "PT_GN",
    ] as const) {
      assert.notEqual(resolveCephPlane(id, FULL), null, `${id} debería resolverse`);
    }
  });

  it("null cuando falta cualquiera de los dos puntos", () => {
    const partial: CephPoints = { S: FULL.S };
    assert.equal(resolveCephPlane("SN", partial), null);
  });

  it("SN devuelve [S, N] en ese orden", () => {
    const line = resolveCephPlane("SN", FULL);
    assert.deepEqual(line, [FULL.S, FULL.N]);
  });
});

describe("availableCephPlanes", () => {
  it("vacío sin ningún punto", () => {
    assert.deepEqual(availableCephPlanes({}), []);
  });

  it("solo SN con S y N marcados", () => {
    assert.deepEqual(availableCephPlanes({ S: FULL.S, N: FULL.N }), ["SN"]);
  });

  it("todos los 14 con el trazado completo", () => {
    assert.equal(availableCephPlanes(FULL).length, 14);
  });
});
