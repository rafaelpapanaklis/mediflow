// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Tests del
// agregador: junta H1 básico con las 4 familias nuevas.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFullCephAnalysis } from "../full-analysis";
import { computeCephMeasurements } from "../measurements";
import type { CephPoints } from "../landmarks";

const FULL: CephPoints = {
  S: { x: 0, y: 0 },
  N: { x: 100, y: 0 },
  A: { x: 200, y: 50 },
  B: { x: 200, y: 30 },
  OR: { x: 0, y: 100 },
  PO: { x: 100, y: 100 },
  GO: { x: 100, y: 200 },
  ME: { x: 0, y: 200 },
  L1_TIP: { x: 50, y: 250 },
  L1_APEX: { x: 50, y: 150 },
  GN: { x: 20, y: 260 },
};

describe("computeFullCephAnalysis", () => {
  it("las 5 medidas base salen IGUAL que computeCephMeasurements sola", () => {
    const base = computeCephMeasurements(FULL);
    const full = computeFullCephAnalysis(FULL);
    assert.equal(full.SNA, base.SNA);
    assert.equal(full.SNB, base.SNB);
    assert.equal(full.ANB, base.ANB);
    assert.equal(full.FMA, base.FMA);
    assert.equal(full.IMPA, base.IMPA);
  });

  it("FMIA se deriva de FMA+IMPA sin puntos nuevos", () => {
    const full = computeFullCephAnalysis(FULL);
    assert.equal(full.FMIA, Math.round((180 - full.FMA! - full.IMPA!) * 10) / 10);
  });

  it("SN_GOGN se calcula porque GN está marcado, aunque no sea parte del H1 básico", () => {
    const full = computeFullCephAnalysis(FULL);
    assert.notEqual(full.SN_GOGN, null);
  });

  it("medidas que necesitan puntos no marcados (McNamara/Ricketts) quedan null", () => {
    const full = computeFullCephAnalysis(FULL);
    assert.equal(full.CO_A_MM, null);
    assert.equal(full.FACIAL_AXIS, null);
  });

  it("con {} todo es null", () => {
    const full = computeFullCephAnalysis({});
    assert.ok(Object.values(full).every((v) => v === null));
  });
});
