// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). FMIA se deriva
// de FMA+IMPA ya calculados por H1 básico: FMA+FMIA+IMPA=180° siempre
// (triángulo de Tweed) — no depende de ningún punto nuevo.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDownsTweedMeasurements } from "../downs-tweed";
import type { CephMeasurements } from "../../measurements";

describe("computeDownsTweedMeasurements", () => {
  it("FMIA = 180 - FMA - IMPA (valores de norma clásica suman 180)", () => {
    const base: CephMeasurements = { SNA: 82, SNB: 80, ANB: 2, FMA: 25, IMPA: 90 };
    assert.equal(computeDownsTweedMeasurements(base).FMIA, 65);
  });

  it("null si falta FMA", () => {
    const base: CephMeasurements = { SNA: null, SNB: null, ANB: null, FMA: null, IMPA: 90 };
    assert.equal(computeDownsTweedMeasurements(base).FMIA, null);
  });

  it("null si falta IMPA", () => {
    const base: CephMeasurements = { SNA: null, SNB: null, ANB: null, FMA: 25, IMPA: null };
    assert.equal(computeDownsTweedMeasurements(base).FMIA, null);
  });
});
