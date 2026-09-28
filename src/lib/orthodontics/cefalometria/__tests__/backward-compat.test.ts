// Ortodoncia — cefalometría COMPLETA (ws1-t8, sep-2026). Requisito 6 del
// encargo: "los trazados de 10 puntos ya guardados siguen abriendo". Este
// archivo prueba EXACTAMENTE eso con un fixture que representa un
// `points`/`measurements` tal como quedó guardado por H1 básico (antes de
// esta tarea) — sin ningún campo nuevo.
//
// El diseño es aditivo por construcción (`CephPoints`/`FullCephMeasurements`
// son `Partial<Record<...>>`, y ningún id/clave del catálogo original se
// renombró ni se quitó — ver `landmarks.ts`), así que no hace falta una
// función de migración: el objeto viejo ya es un valor válido del tipo
// nuevo. Este test es la prueba de que eso es cierto, no una promesa.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isCephTracingComplete,
  missingCephLandmarks,
  type CephPoints,
} from "../landmarks";
import { computeCephMeasurements } from "../measurements";
import { computeFullCephAnalysis } from "../full-analysis";
import { evaluateAgainstNorms } from "../norms";

/** Un trazado real guardado por H1 básico, ola 1 — solo los 10 puntos originales. */
const LEGACY_POINTS: CephPoints = {
  S: { x: 412, y: 268 },
  N: { x: 520, y: 240 },
  A: { x: 560, y: 330 },
  B: { x: 545, y: 410 },
  GO: { x: 380, y: 480 },
  ME: { x: 460, y: 560 },
  OR: { x: 470, y: 300 },
  PO: { x: 350, y: 290 },
  L1_TIP: { x: 470, y: 470 },
  L1_APEX: { x: 465, y: 420 },
};

describe("un trazado legado (H1 básico, solo 10 puntos) sigue funcionando", () => {
  it("sigue estando 'completo' para H1 básico", () => {
    assert.equal(isCephTracingComplete(LEGACY_POINTS), true);
    assert.deepEqual(missingCephLandmarks(LEGACY_POINTS), []);
  });

  it("computeCephMeasurements (la función que ya usa saveCephalometricAnalysis) calcula las 5 medidas igual que siempre", () => {
    const m = computeCephMeasurements(LEGACY_POINTS);
    assert.notEqual(m.SNA, null);
    assert.notEqual(m.SNB, null);
    assert.notEqual(m.ANB, null);
    assert.notEqual(m.FMA, null);
    assert.notEqual(m.IMPA, null);
  });

  it("evaluateAgainstNorms (H1 básico) sigue evaluando las 5 medidas", () => {
    const m = computeCephMeasurements(LEGACY_POINTS);
    const evals = evaluateAgainstNorms(m, "STEINER", "STANDARD");
    assert.equal(evals.length, 5);
  });

  it("el agregador nuevo (computeFullCephAnalysis) le entra igual: las 5 de siempre + todo lo nuevo en null", () => {
    const full = computeFullCephAnalysis(LEGACY_POINTS);
    // Las 5 de H1 básico siguen saliendo.
    assert.notEqual(full.SNA, null);
    assert.notEqual(full.FMA, null);
    assert.notEqual(full.IMPA, null);
    // Downs/Tweed SÍ se puede derivar (solo necesita FMA+IMPA, que ya están).
    assert.notEqual(full.FMIA, null);
    // Todo lo que necesita puntos nuevos (Steiner extra, Ricketts, McNamara) queda null — nunca inventado.
    assert.equal(full.SN_GOGN, null);
    assert.equal(full.U1_NA_DEG, null);
    assert.equal(full.FACIAL_AXIS, null);
    assert.equal(full.CO_A_MM, null);
  });

  it("un JSON.parse(JSON.stringify(...)) del fixture (simula ida y vuelta por la columna JSONB) da el mismo resultado", () => {
    const roundTripped: CephPoints = JSON.parse(JSON.stringify(LEGACY_POINTS));
    assert.deepEqual(computeCephMeasurements(roundTripped), computeCephMeasurements(LEGACY_POINTS));
  });
});
