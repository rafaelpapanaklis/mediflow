// Tests de los helpers de formato del rediseño ortho.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fmtDay,
  fmtDayLong,
  fmtMoney,
  fmtPct,
  fmtMm,
  avatarInitials,
  clinicalSeverityColor,
} from "../atoms/format";

describe("format helpers", () => {
  it("fmtMoney usa locale es-MX con $", () => {
    assert.equal(fmtMoney(33340), "$33,340");
    assert.equal(fmtMoney(0), "$0");
    assert.equal(fmtMoney(null), "—");
  });

  it("fmtPct redondea y agrega %", () => {
    assert.equal(fmtPct(78.4), "78%");
    assert.equal(fmtPct(100), "100%");
    assert.equal(fmtPct(null), "—");
  });

  it("fmtMm con un decimal", () => {
    assert.equal(fmtMm(3.5), "3.5 mm");
    assert.equal(fmtMm(0), "0.0 mm");
    assert.equal(fmtMm(null), "—");
  });

  it("avatarInitials toma 2 iniciales en upper", () => {
    assert.equal(avatarInitials("Gabriela Hernández Ruiz"), "GH");
    assert.equal(avatarInitials("juan pérez"), "JP");
    assert.equal(avatarInitials("Ana"), "A");
  });

  it("clinicalSeverityColor por umbrales", () => {
    assert.equal(clinicalSeverityColor(15), "emerald");
    assert.equal(clinicalSeverityColor(20), "amber");
    assert.equal(clinicalSeverityColor(29), "amber");
    assert.equal(clinicalSeverityColor(30), "rose");
    assert.equal(clinicalSeverityColor(60), "rose");
  });
  it("fmtDay pinta el día de calendario sin correrlo por la zona horaria", () => {
    // `new Date("2026-10-05")` es medianoche UTC: en México (UTC-6) se leía
    // como el 4 de octubre. El vencimiento de una mensualidad es un DÍA.
    const dia = fmtDay("2026-10-05");
    assert.match(dia, /^05/);
    assert.match(dia, /oct/i);
    assert.equal(fmtDay(null), "—");
    assert.equal(fmtDay(""), "—");
  });

  it("fmtDay/fmtDayLong toman el DÍA aunque llegue como datetime UTC (H8)", () => {
    // `installedAt`/`estimatedEndDate` viajan como
    // "2026-07-28T00:00:00.000Z" (un <input type="date"> pasado por
    // `new Date(v).toISOString()`), no como "2026-07-28" a secas. En una
    // zona negativa (México) esto se leía como "27 jul".
    const dia = fmtDay("2026-07-28T00:00:00.000Z");
    assert.match(dia, /^28/);
    assert.match(dia, /jul/i);

    const largo = fmtDayLong("2026-07-28T00:00:00.000Z");
    assert.match(largo, /^28/);
    assert.match(largo, /jul/i);
    assert.match(largo, /2026/);
    assert.equal(fmtDayLong(null), "—");
  });
});
