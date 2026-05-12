// Tests de los helpers de formato del rediseño ortho.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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
});
