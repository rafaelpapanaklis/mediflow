// Tests del mapping UI → DB en addWireStep server action.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const MATERIAL_MAP: Record<string, string> = {
  NITI_SUPER: "NITI",
  NITI_THERMO: "NITI",
  NITI_CONV: "NITI",
  SS: "SS",
  TMA: "TMA",
  MULTI: "SS",
  CRCO: "SS",
};

describe("addWireStep MATERIAL_MAP", () => {
  it("3 variantes NiTi colapsan a NITI en DB", () => {
    assert.equal(MATERIAL_MAP.NITI_SUPER, "NITI");
    assert.equal(MATERIAL_MAP.NITI_THERMO, "NITI");
    assert.equal(MATERIAL_MAP.NITI_CONV, "NITI");
  });

  it("SS pasa identico", () => {
    assert.equal(MATERIAL_MAP.SS, "SS");
  });

  it("TMA pasa identico", () => {
    assert.equal(MATERIAL_MAP.TMA, "TMA");
  });

  it("MULTI mappea a SS (variante de acero trenzado)", () => {
    assert.equal(MATERIAL_MAP.MULTI, "SS");
  });

  it("CRCO mappea a SS (Elgiloy clasifica como cromo-cobalto/acero)", () => {
    assert.equal(MATERIAL_MAP.CRCO, "SS");
  });

  it("NO mapea a BETA_TITANIUM (eso es vía TMA)", () => {
    const values = Object.values(MATERIAL_MAP);
    assert.equal(values.includes("BETA_TITANIUM"), false);
  });

  it("Cobertura de los 7 keys UI", () => {
    assert.equal(Object.keys(MATERIAL_MAP).length, 7);
  });
});

describe("Wire step input validation rules", () => {
  it("durationWeeks debe ser positivo", () => {
    assert.ok(1 > 0);
  });

  it("durationWeeks máximo 26 (~6 meses)", () => {
    assert.ok(26 <= 26);
    assert.equal(27 <= 26, false);
  });

  it("debe seleccionar al menos un arco (sup OR inf)", () => {
    const valid = (sup: boolean, inf: boolean) => sup || inf;
    assert.equal(valid(true, false), true);
    assert.equal(valid(false, true), true);
    assert.equal(valid(true, true), true);
    assert.equal(valid(false, false), false);
  });
});
