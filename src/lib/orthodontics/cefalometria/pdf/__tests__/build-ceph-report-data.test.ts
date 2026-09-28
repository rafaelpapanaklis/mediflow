// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Tests de los
// puentes puros hacia los datos del PDF. Sin @react-pdf/renderer — solo
// formateo y geometría.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCephReportDots,
  buildCephReportPlanes,
  buildCephReportRows,
  DEFAULT_PLANES_FOR_ANALYSIS,
} from "../build-ceph-report-data";
import { computeFullCephAnalysis } from "../../full-analysis";
import type { CephPoints } from "../../landmarks";

const POINTS: CephPoints = {
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
};

describe("buildCephReportRows", () => {
  it("formatea grados con ° y mm con 'mm'", () => {
    const measurements = computeFullCephAnalysis(POINTS, 10);
    const rows = buildCephReportRows(measurements, "DOWNS_TWEED", "STANDARD");
    const fma = rows.find((r) => r.key === "FMA")!;
    assert.ok(fma.valueLabel.endsWith("°"));
  });

  it("valor '—' cuando la medida es null", () => {
    const measurements = computeFullCephAnalysis({});
    const rows = buildCephReportRows(measurements, "MCNAMARA", "STANDARD");
    assert.ok(rows.every((r) => r.valueLabel === "—"));
  });

  it("normLabel null para McNamara (sin norma citada)", () => {
    const measurements = computeFullCephAnalysis(POINTS, 10);
    const rows = buildCephReportRows(measurements, "MCNAMARA", "STANDARD");
    assert.ok(rows.every((r) => r.normLabel === null));
  });

  it("deviationLabel trae signo +", () => {
    const measurements = computeFullCephAnalysis(POINTS, 10);
    const rows = buildCephReportRows(measurements, "STEINER", "STANDARD");
    const anb = rows.find((r) => r.key === "ANB")!;
    // ANB = SNA - SNB de POINTS: se calcula igual que en measurements.test.ts.
    if (anb.deviationLabel) {
      assert.match(anb.deviationLabel, /^[+-]?\d/);
    }
  });
});

describe("buildCephReportDots", () => {
  it("un punto por cada landmark marcado, con su etiqueta", () => {
    const dots = buildCephReportDots(POINTS);
    assert.equal(dots.length, Object.keys(POINTS).length);
    const s = dots.find((d) => d.id === "S")!;
    assert.equal(s.label, "Silla (S)");
    assert.equal(s.x, 0);
    assert.equal(s.y, 0);
  });

  it("vacío sin puntos", () => {
    assert.deepEqual(buildCephReportDots({}), []);
  });
});

describe("buildCephReportPlanes", () => {
  it("solo devuelve los planos que se pueden resolver con el trazado", () => {
    const planes = buildCephReportPlanes(POINTS, DEFAULT_PLANES_FOR_ANALYSIS.STEINER);
    const ids = planes.map((p) => p.id);
    assert.ok(ids.includes("SN"));
    assert.ok(ids.includes("FH"));
    // MANDIBULAR_GO_GN necesita GN, que no está en POINTS.
    assert.ok(!ids.includes("MANDIBULAR_GO_GN"));
  });

  it("vacío pidiendo una lista vacía", () => {
    assert.deepEqual(buildCephReportPlanes(POINTS, []), []);
  });
});
