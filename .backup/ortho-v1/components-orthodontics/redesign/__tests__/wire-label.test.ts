// Tests del helper que renderiza el label de wire (NiTi 0.014, SS 19x25, etc.).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrthoWireMaterial } from "../types";

function wireLabel(wire: { gauge: string; material: OrthoWireMaterial } | null): string {
  if (!wire) return "—";
  const map: Record<OrthoWireMaterial, string> = {
    NITI: "NiTi",
    SS: "SS",
    TMA: "TMA",
    BETA_TITANIUM: "β-Ti",
  };
  return `${map[wire.material]} ${wire.gauge}`;
}

describe("wireLabel", () => {
  it("NiTi 0.014 (round inicial)", () => {
    assert.equal(wireLabel({ material: "NITI", gauge: "0.014" }), "NiTi 0.014");
  });
  it("NiTi 0.018 round trabajo", () => {
    assert.equal(wireLabel({ material: "NITI", gauge: "0.018" }), "NiTi 0.018");
  });
  it("SS 19x25 trabajo sagital", () => {
    assert.equal(wireLabel({ material: "SS", gauge: "19x25" }), "SS 19x25");
  });
  it("TMA 16x22 detalles", () => {
    assert.equal(wireLabel({ material: "TMA", gauge: "16x22" }), "TMA 16x22");
  });
  it("β-Ti finishing", () => {
    assert.equal(wireLabel({ material: "BETA_TITANIUM", gauge: "19x25" }), "β-Ti 19x25");
  });
  it("null devuelve guion", () => {
    assert.equal(wireLabel(null), "—");
  });
});
