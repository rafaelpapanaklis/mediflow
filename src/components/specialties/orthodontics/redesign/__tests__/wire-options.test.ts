// Tests del catálogo de wire options en DrawerWireStep G3.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WIRE_MATERIAL_OPTIONS,
  WIRE_GAUGE_ROUND,
  WIRE_GAUGE_RECT,
} from "../drawers/DrawerWireStep";

describe("WIRE_MATERIAL_OPTIONS", () => {
  it("incluye los 7 materiales del mockup canónico", () => {
    assert.equal(WIRE_MATERIAL_OPTIONS.length, 7);
  });

  it("primero NiTi superelástico (alineación inicial)", () => {
    assert.equal(WIRE_MATERIAL_OPTIONS[0]?.key, "NITI_SUPER");
    assert.match(WIRE_MATERIAL_OPTIONS[0]?.label ?? "", /superel/i);
  });

  it("segundo NiTi termoactivado", () => {
    assert.equal(WIRE_MATERIAL_OPTIONS[1]?.key, "NITI_THERMO");
  });

  it("tercero NiTi convencional", () => {
    assert.equal(WIRE_MATERIAL_OPTIONS[2]?.key, "NITI_CONV");
  });

  it("contiene SS para mecánicas de cierre", () => {
    const ss = WIRE_MATERIAL_OPTIONS.find((o) => o.key === "SS");
    assert.ok(ss);
    assert.match(ss!.hint, /cierre|working/i);
  });

  it("contiene TMA para detalles", () => {
    const tma = WIRE_MATERIAL_OPTIONS.find((o) => o.key === "TMA");
    assert.ok(tma);
    assert.match(tma!.hint, /detalles|finishing|springs/i);
  });

  it("contiene Multi-stranded", () => {
    const m = WIRE_MATERIAL_OPTIONS.find((o) => o.key === "MULTI");
    assert.ok(m);
    assert.match(m!.label, /Multi/i);
  });

  it("contiene Cr-Co (Elgiloy) para custom", () => {
    const c = WIRE_MATERIAL_OPTIONS.find((o) => o.key === "CRCO");
    assert.ok(c);
    assert.match(c!.label, /Cr-Co|Elgiloy/i);
  });

  it("todos los keys son strings únicos", () => {
    const keys = WIRE_MATERIAL_OPTIONS.map((o) => o.key);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("WIRE_GAUGE_ROUND", () => {
  it("contiene exactamente 3 calibres redondos", () => {
    assert.equal(WIRE_GAUGE_ROUND.length, 3);
  });

  it("incluye .014 .016 .018", () => {
    const labels = WIRE_GAUGE_ROUND.map((g) => g.label).sort();
    assert.deepEqual(labels, [".014", ".016", ".018"]);
  });

  it("keys son strings sin punto decimal (coherente con DB)", () => {
    for (const g of WIRE_GAUGE_ROUND) {
      assert.equal(g.key.includes("."), false);
    }
  });
});

describe("WIRE_GAUGE_RECT", () => {
  it("contiene exactamente 3 calibres rectangulares", () => {
    assert.equal(WIRE_GAUGE_RECT.length, 3);
  });

  it("incluye 16x22 17x25 19x25", () => {
    const labels = WIRE_GAUGE_RECT.map((g) => g.label).sort();
    assert.deepEqual(labels, ["16x22", "17x25", "19x25"]);
  });

  it("keys coinciden con labels (formato uniforme)", () => {
    for (const g of WIRE_GAUGE_RECT) {
      assert.equal(g.key, g.label);
    }
  });
});
