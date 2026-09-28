// Tests de buildHygieneTrend/detectHygieneWorsening (C8, ws1-t4 — Control y agenda).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHygieneTrend, detectHygieneWorsening } from "../hygiene-trend";
import type { TreatmentCardDTO } from "@/components/specialties/orthodontics/redesign/types";

function card(over: Partial<TreatmentCardDTO> & { id: string; visitDate: string }): TreatmentCardDTO {
  return {
    cardNumber: 1,
    durationMin: 30,
    phaseKey: "ALIGNMENT",
    monthAt: 1,
    wireFrom: null,
    wireTo: null,
    soap: { s: "", o: "", a: "", p: "" },
    hygiene: { plaquePct: null, gingivitis: null, whiteSpots: false },
    hasProgressPhoto: false,
    photoSetId: null,
    nextDate: null,
    nextDurationMin: null,
    status: "SIGNED",
    signedAt: null,
    signedByName: null,
    elastics: [],
    iprPoints: [],
    brokenBrackets: [],
    ...over,
  };
}

describe("buildHygieneTrend", () => {
  it("ordena por visitDate, sin importar el orden de entrada", () => {
    const c1 = card({ id: "c1", visitDate: "2026-03-01T10:00:00.000Z", cardNumber: 3 });
    const c2 = card({ id: "c2", visitDate: "2026-01-01T10:00:00.000Z", cardNumber: 1 });
    const trend = buildHygieneTrend([c1, c2]);
    assert.deepEqual(
      trend.map((p) => p.cardId),
      ["c2", "c1"],
    );
  });

  it("descarta los DRAFT: solo lo firmado es dato clínico confirmado", () => {
    const draft = card({ id: "d1", visitDate: "2026-01-01T10:00:00.000Z", status: "DRAFT" });
    const signed = card({ id: "s1", visitDate: "2026-02-01T10:00:00.000Z", status: "SIGNED" });
    const trend = buildHygieneTrend([draft, signed]);
    assert.deepEqual(
      trend.map((p) => p.cardId),
      ["s1"],
    );
  });

  it("hadElastics refleja si esa visita registró elásticos", () => {
    const withElastics = card({
      id: "c1",
      visitDate: "2026-01-01T10:00:00.000Z",
      elastics: [{ id: "e1", elasticClass: "CLASE_II", config: '1/4" 6oz', zone: "INTERMAXILAR" }],
    });
    const trend = buildHygieneTrend([withElastics]);
    assert.equal(trend[0].hadElastics, true);
  });
});

describe("detectHygieneWorsening", () => {
  it("sin puntos suficientes (0 o 1): no hay aviso", () => {
    assert.deepEqual(detectHygieneWorsening([]), { worsening: false, reasons: [] });
    const one = buildHygieneTrend([card({ id: "c1", visitDate: "2026-01-01T10:00:00.000Z" })]);
    assert.deepEqual(detectHygieneWorsening(one), { worsening: false, reasons: [] });
  });

  it("placa sube 15 puntos o más entre el primero y el último de la ventana: avisa", () => {
    const trend = buildHygieneTrend([
      card({ id: "c1", visitDate: "2026-01-01T10:00:00.000Z", hygiene: { plaquePct: 10, gingivitis: null, whiteSpots: false } }),
      card({ id: "c2", visitDate: "2026-02-01T10:00:00.000Z", hygiene: { plaquePct: 30, gingivitis: null, whiteSpots: false } }),
    ]);
    const alert = detectHygieneWorsening(trend);
    assert.equal(alert.worsening, true);
    assert.match(alert.reasons[0], /placa subió de 10% a 30%/);
  });

  it("placa sube menos de 15 puntos: no avisa por eso", () => {
    const trend = buildHygieneTrend([
      card({ id: "c1", visitDate: "2026-01-01T10:00:00.000Z", hygiene: { plaquePct: 10, gingivitis: null, whiteSpots: false } }),
      card({ id: "c2", visitDate: "2026-02-01T10:00:00.000Z", hygiene: { plaquePct: 20, gingivitis: null, whiteSpots: false } }),
    ]);
    assert.equal(detectHygieneWorsening(trend).worsening, false);
  });

  it("gingivitis empeora (AUSENTE → MODERADA): avisa", () => {
    const trend = buildHygieneTrend([
      card({ id: "c1", visitDate: "2026-01-01T10:00:00.000Z", hygiene: { plaquePct: null, gingivitis: "AUSENTE", whiteSpots: false } }),
      card({ id: "c2", visitDate: "2026-02-01T10:00:00.000Z", hygiene: { plaquePct: null, gingivitis: "MODERADA", whiteSpots: false } }),
    ]);
    const alert = detectHygieneWorsening(trend);
    assert.equal(alert.worsening, true);
    assert.match(alert.reasons[0], /gingivitis pasó de ausente a moderada/);
  });

  it("gingivitis mejora (SEVERA → LEVE): NO avisa", () => {
    const trend = buildHygieneTrend([
      card({ id: "c1", visitDate: "2026-01-01T10:00:00.000Z", hygiene: { plaquePct: null, gingivitis: "SEVERA", whiteSpots: false } }),
      card({ id: "c2", visitDate: "2026-02-01T10:00:00.000Z", hygiene: { plaquePct: null, gingivitis: "LEVE", whiteSpots: false } }),
    ]);
    assert.equal(detectHygieneWorsening(trend).worsening, false);
  });

  it("aparecen manchas blancas nuevas: avisa", () => {
    const trend = buildHygieneTrend([
      card({ id: "c1", visitDate: "2026-01-01T10:00:00.000Z", hygiene: { plaquePct: null, gingivitis: null, whiteSpots: false } }),
      card({ id: "c2", visitDate: "2026-02-01T10:00:00.000Z", hygiene: { plaquePct: null, gingivitis: null, whiteSpots: true } }),
    ]);
    const alert = detectHygieneWorsening(trend);
    assert.equal(alert.worsening, true);
    assert.match(alert.reasons[0], /manchas blancas nuevas/);
  });

  it("deja de reportar elásticos: avisa", () => {
    const withElastics = card({
      id: "c1",
      visitDate: "2026-01-01T10:00:00.000Z",
      elastics: [{ id: "e1", elasticClass: "CLASE_II", config: '1/4" 6oz', zone: "INTERMAXILAR" }],
    });
    const noElastics = card({ id: "c2", visitDate: "2026-02-01T10:00:00.000Z", elastics: [] });
    const trend = buildHygieneTrend([withElastics, noElastics]);
    const alert = detectHygieneWorsening(trend);
    assert.equal(alert.worsening, true);
    assert.match(alert.reasons[0], /dejó de reportar uso de elásticos/);
  });

  it("todo estable o mejorando: ningún motivo, sin aviso", () => {
    const trend = buildHygieneTrend([
      card({ id: "c1", visitDate: "2026-01-01T10:00:00.000Z", hygiene: { plaquePct: 40, gingivitis: "MODERADA", whiteSpots: true } }),
      card({ id: "c2", visitDate: "2026-02-01T10:00:00.000Z", hygiene: { plaquePct: 20, gingivitis: "LEVE", whiteSpots: true } }),
    ]);
    assert.deepEqual(detectHygieneWorsening(trend), { worsening: false, reasons: [] });
  });

  it("solo mira la ventana (lookback): un control viejo malo no dispara el aviso si los últimos 3 van bien", () => {
    const trend = buildHygieneTrend([
      card({ id: "c0", visitDate: "2025-01-01T10:00:00.000Z", hygiene: { plaquePct: 5, gingivitis: null, whiteSpots: false } }),
      card({ id: "c1", visitDate: "2026-01-01T10:00:00.000Z", hygiene: { plaquePct: 60, gingivitis: null, whiteSpots: false } }),
      card({ id: "c2", visitDate: "2026-02-01T10:00:00.000Z", hygiene: { plaquePct: 50, gingivitis: null, whiteSpots: false } }),
      card({ id: "c3", visitDate: "2026-03-01T10:00:00.000Z", hygiene: { plaquePct: 40, gingivitis: null, whiteSpots: false } }),
    ]);
    // Ventana por defecto = últimos 3 (c1,c2,c3): baja de 60 a 40 → mejora, no empeora.
    assert.equal(detectHygieneWorsening(trend).worsening, false);
  });
});
