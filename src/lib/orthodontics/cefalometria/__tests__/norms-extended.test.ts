// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Tests de
// `norms-extended.ts`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateFullAgainstNorms, getFullNormTable, ANALYSIS_MEASUREMENT_KEYS } from "../norms-extended";
import type { FullCephMeasurements } from "../full-analysis";

const EMPTY: FullCephMeasurements = {
  SNA: null,
  SNB: null,
  ANB: null,
  FMA: null,
  IMPA: null,
  SN_GOGN: null,
  U1_NA_DEG: null,
  U1_NA_MM: null,
  L1_NB_DEG: null,
  L1_NB_MM: null,
  INTERINCISAL: null,
  OCCLUSAL_SN: null,
  FACIAL_AXIS: null,
  FACIAL_DEPTH: null,
  MANDIBULAR_PLANE_RICKETTS: null,
  CONVEXITY_MM: null,
  UPPER_LIP_E_MM: null,
  LOWER_LIP_E_MM: null,
  A_TO_NPERP_MM: null,
  PG_TO_NPERP_MM: null,
  CO_A_MM: null,
  CO_GN_MM: null,
  MAXMAND_DIFFERENTIAL_MM: null,
  LOWER_FACE_HEIGHT_MM: null,
  FMIA: null,
};

describe("getFullNormTable", () => {
  it("STEINER trae SN-GoGn/interincisal citados", () => {
    const t = getFullNormTable("STEINER", "STANDARD");
    assert.equal(t.SN_GOGN?.mean, 32);
    assert.equal(t.INTERINCISAL?.mean, 131);
  });

  it("MCNAMARA no tiene ninguna norma citada (edad/sexo)", () => {
    const t = getFullNormTable("MCNAMARA", "STANDARD");
    for (const key of ANALYSIS_MEASUREMENT_KEYS.MCNAMARA) {
      assert.equal(t[key], null, `${key} debería quedar sin norma`);
    }
  });

  it("MEXICAN solo sobreescribe ANB/IMPA, el resto sigue clásico", () => {
    const classic = getFullNormTable("STEINER", "STANDARD");
    const mexican = getFullNormTable("STEINER", "MEXICAN");
    assert.equal(mexican.ANB?.mean, 3);
    assert.equal(mexican.SN_GOGN?.mean, classic.SN_GOGN?.mean);
  });

  it("DOWNS_TWEED: FMA+FMIA+IMPA suman 180 en sus medias", () => {
    const t = getFullNormTable("DOWNS_TWEED", "STANDARD");
    assert.equal((t.FMA?.mean ?? 0) + (t.FMIA?.mean ?? 0) + (t.IMPA?.mean ?? 0), 180);
  });
});

describe("evaluateFullAgainstNorms", () => {
  it("sin-medida cuando el valor es null", () => {
    const evals = evaluateFullAgainstNorms(EMPTY, "STEINER", "STANDARD");
    assert.ok(evals.every((e) => e.interpretation === "sin-medida"));
  });

  it("sin-norma cuando McNamara no tiene norma citada aunque el valor exista", () => {
    const m: FullCephMeasurements = { ...EMPTY, CO_A_MM: 90 };
    const evals = evaluateFullAgainstNorms(m, "MCNAMARA", "STANDARD");
    const row = evals.find((e) => e.key === "CO_A_MM")!;
    assert.equal(row.interpretation, "sin-norma");
    assert.equal(row.value, 90);
  });

  it("normal dentro de 1 SD, aumentado por encima", () => {
    const normal: FullCephMeasurements = { ...EMPTY, SN_GOGN: 32 };
    const alto: FullCephMeasurements = { ...EMPTY, SN_GOGN: 45 }; // media 32, sd 5 → +2.6 SD
    const evalNormal = evaluateFullAgainstNorms(normal, "STEINER", "STANDARD").find((e) => e.key === "SN_GOGN")!;
    const evalAlto = evaluateFullAgainstNorms(alto, "STEINER", "STANDARD").find((e) => e.key === "SN_GOGN")!;
    assert.equal(evalNormal.interpretation, "normal");
    assert.equal(evalAlto.interpretation, "aumentado");
  });

  it("solo evalúa las medidas del análisis pedido", () => {
    const evals = evaluateFullAgainstNorms(EMPTY, "RICKETTS", "STANDARD");
    assert.deepEqual(
      evals.map((e) => e.key),
      ANALYSIS_MEASUREMENT_KEYS.RICKETTS,
    );
  });
});
