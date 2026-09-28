// Ortodoncia — Parte 8. Tests del cálculo de alineador esperado (H12).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareTrayToExpected, computeExpectedTray } from "../expected-tray";

function daysAgo(n: number): Date {
  const d = new Date("2026-09-27T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

describe("computeExpectedTray", () => {
  it("día 0 → alineador 1", () => {
    const r = computeExpectedTray({
      startedAt: daysAgo(0),
      totalTrays: 30,
      changeIntervalDays: 14,
      today: daysAgo(0),
    });
    assert.equal(r.expectedTray, 1);
    assert.equal(r.isPastLastTray, false);
  });

  it("a los 14 días con intervalo de 14 pasa al alineador 2", () => {
    const r = computeExpectedTray({
      startedAt: daysAgo(14),
      totalTrays: 30,
      changeIntervalDays: 14,
      today: daysAgo(0),
    });
    assert.equal(r.expectedTray, 2);
  });

  it("se acota al total: no propone un número mayor al plan", () => {
    const r = computeExpectedTray({
      startedAt: daysAgo(1000),
      totalTrays: 30,
      changeIntervalDays: 14,
      today: daysAgo(0),
    });
    assert.equal(r.expectedTray, 30);
    assert.equal(r.isPastLastTray, true);
  });

  it("intervalo inválido (0) no revienta: se trata como 1 día", () => {
    const r = computeExpectedTray({
      startedAt: daysAgo(5),
      totalTrays: 30,
      changeIntervalDays: 0,
      today: daysAgo(0),
    });
    assert.equal(r.expectedTray, 6);
  });
});

describe("compareTrayToExpected", () => {
  it("igual al esperado → on-track", () => {
    assert.equal(compareTrayToExpected(5, 5).status, "on-track");
  });

  it("por debajo del esperado → behind (atrasado)", () => {
    const r = compareTrayToExpected(3, 5);
    assert.equal(r.status, "behind");
    assert.equal(r.delta, -2);
  });

  it("por encima del esperado → ahead (adelantado)", () => {
    const r = compareTrayToExpected(7, 5);
    assert.equal(r.status, "ahead");
    assert.equal(r.delta, 2);
  });
});
