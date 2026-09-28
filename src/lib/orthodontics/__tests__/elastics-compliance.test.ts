// Orthodontics — tests del threshold de compliance de elásticos (H14).
//
// Ortodoncia — Parte 8 (ws1-t8, sep-2026): este archivo tenía solo el
// umbral suelto (70%) sin implementación real detrás. Ahora prueba
// `summarizeElasticsCompliance` de `../elastics/compliance`, que es la
// implementación real; se conserva el nombre del describe original.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOW_COMPLIANCE_THRESHOLD, summarizeElasticsCompliance } from "../elastics/compliance";
import type { ElasticsLogEntry } from "../elastics/compliance";

function log(date: string, wornHours: number | null, usedElastics = wornHours !== null && wornHours > 0): ElasticsLogEntry {
  return { date, wornHours, usedElastics };
}

describe("Elastics compliance threshold", () => {
  it("compliance < 70% dispara reminder motivacional", () => {
    const summary = summarizeElasticsCompliance(
      [log("2026-09-21", 10), log("2026-09-22", 8), log("2026-09-23", 22)],
      { windowDays: 7, targetHoursPerDay: 20 },
    );
    // Solo 1 de 7 días de la ventana cumplió la meta → ~14.3%.
    assert.equal(summary.compliancePct! < LOW_COMPLIANCE_THRESHOLD, true);
    assert.equal(summary.isLow, true);
  });

  it("compliance >= 70% NO dispara reminder", () => {
    const logs = Array.from({ length: 7 }, (_, i) => log(`2026-09-2${i}`, 21));
    const summary = summarizeElasticsCompliance(logs, { windowDays: 7, targetHoursPerDay: 20 });
    assert.equal(summary.compliancePct, 100);
    assert.equal(summary.isLow, false);
  });

  it("compliance 0% es válido (paciente no usó nada, no revienta)", () => {
    const logs = Array.from({ length: 7 }, (_, i) => log(`2026-09-2${i}`, 0));
    const summary = summarizeElasticsCompliance(logs, { windowDays: 7, targetHoursPerDay: 20 });
    assert.equal(summary.compliancePct, 0);
    assert.equal(summary.isLow, true);
  });

  it("días sin registrar cuentan como no cumplidos, no se ignoran", () => {
    // Solo 2 días registrados (ambos cumpliendo) sobre una ventana de 7.
    const summary = summarizeElasticsCompliance([log("2026-09-26", 22), log("2026-09-27", 22)], {
      windowDays: 7,
      targetHoursPerDay: 20,
    });
    assert.equal(summary.loggedDays, 2);
    assert.equal(summary.compliancePct, Math.round((2 / 7) * 1000) / 10);
  });

  it("día sin horas pero marcado como usado cuenta como cumplido", () => {
    const summary = summarizeElasticsCompliance([{ date: "2026-09-27", wornHours: null, usedElastics: true }], {
      windowDays: 1,
      targetHoursPerDay: 20,
    });
    assert.equal(summary.compliancePct, 100);
  });
});
