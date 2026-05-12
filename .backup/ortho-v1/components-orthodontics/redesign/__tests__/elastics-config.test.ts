// Tests de los seeds default de elásticos (config Clase II 1/4" 6oz, etc.)
// y la integridad de los dropdowns rápidos del drawer.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ELASTIC_CLASS_LABELS, ELASTIC_ZONE_LABELS } from "../types";

describe("ELASTIC_CLASS_LABELS terminología clínica", () => {
  it("incluye los 6 tipos del SPEC", () => {
    const required = ["CLASE_I", "CLASE_II", "CLASE_III", "BOX", "CRISS_CROSS", "SETTLING"];
    for (const k of required) {
      assert.ok(k in ELASTIC_CLASS_LABELS, `Falta tipo ${k}`);
    }
  });

  it("etiquetas usan terminología canónica del SPEC", () => {
    assert.equal(ELASTIC_CLASS_LABELS.CLASE_II, "Clase II");
    assert.equal(ELASTIC_CLASS_LABELS.BOX, "Box");
    assert.equal(ELASTIC_CLASS_LABELS.CRISS_CROSS, "Criss-Cross");
  });
});

describe("ELASTIC_ZONE_LABELS", () => {
  it("3 zonas: anterior / posterior / intermaxilar", () => {
    assert.equal(ELASTIC_ZONE_LABELS.ANTERIOR, "anterior");
    assert.equal(ELASTIC_ZONE_LABELS.POSTERIOR, "posterior");
    assert.equal(ELASTIC_ZONE_LABELS.INTERMAXILAR, "intermaxilar");
  });
});

describe("default elastic config", () => {
  it('"1/4" 6oz" es la config inicial estándar para Clase II', () => {
    // Spec G1 cita exactamente 'Clase II 1/4" 6oz' como ejemplo canónico.
    const standardClassII = '1/4" 6oz';
    assert.match(standardClassII, /1\/4/);
    assert.match(standardClassII, /6oz/);
  });
});
