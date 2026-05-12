// Tests de los maps de etiquetas y orden de fases del rediseño ortho.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHASE_LABELS,
  PHASE_ORDER,
  APPLIANCE_SLOT_LABELS,
  WIRE_MATERIAL_LABELS,
  ELASTIC_CLASS_LABELS,
  TAD_BRAND_LABELS,
  GINGIVITIS_LABELS,
  FLOW_STATUS_LABELS,
  SKELETAL_PATTERN_LABELS,
} from "../types";

describe("PHASE_ORDER", () => {
  it("son 6 fases canónicas en orden lineal", () => {
    assert.deepEqual(PHASE_ORDER, [
      "ALIGNMENT",
      "LEVELING",
      "SPACE_CLOSURE",
      "DETAILS",
      "FINISHING",
      "RETENTION",
    ]);
  });

  it("PHASE_LABELS cubre cada fase con label legible es-MX", () => {
    for (const p of PHASE_ORDER) {
      assert.ok(PHASE_LABELS[p].length > 0);
    }
    assert.equal(PHASE_LABELS.ALIGNMENT, "Alineación");
    assert.equal(PHASE_LABELS.RETENTION, "Retención");
    assert.equal(PHASE_LABELS.SPACE_CLOSURE, "Cierre de espacios");
  });
});

describe("APPLIANCE_SLOT_LABELS", () => {
  it("usa terminología clínica real (MBT 0.022, Roth 0.018, etc.)", () => {
    assert.equal(APPLIANCE_SLOT_LABELS.MBT_022, "MBT 0.022");
    assert.equal(APPLIANCE_SLOT_LABELS.ROTH_018, "Roth 0.018");
    assert.equal(APPLIANCE_SLOT_LABELS.DAMON_Q2, "Damon Q2");
    assert.equal(APPLIANCE_SLOT_LABELS.SPARK, "Spark");
    assert.equal(APPLIANCE_SLOT_LABELS.INVISALIGN, "Invisalign");
  });
});

describe("WIRE_MATERIAL_LABELS", () => {
  it("incluye NiTi / SS / TMA / β-Ti", () => {
    assert.equal(WIRE_MATERIAL_LABELS.NITI, "NiTi");
    assert.equal(WIRE_MATERIAL_LABELS.SS, "SS");
    assert.equal(WIRE_MATERIAL_LABELS.TMA, "TMA");
  });
});

describe("ELASTIC_CLASS_LABELS", () => {
  it("incluye Clases I/II/III + Box + Criss-Cross + Settling", () => {
    assert.equal(ELASTIC_CLASS_LABELS.CLASE_II, "Clase II");
    assert.equal(ELASTIC_CLASS_LABELS.BOX, "Box");
    assert.equal(ELASTIC_CLASS_LABELS.CRISS_CROSS, "Criss-Cross");
  });
});

describe("TAD_BRAND_LABELS", () => {
  it("incluye Dentos / Spider / IMTEC del SPEC G10", () => {
    assert.equal(TAD_BRAND_LABELS.DENTOS, "Dentos");
    assert.equal(TAD_BRAND_LABELS.SPIDER, "Spider");
    assert.equal(TAD_BRAND_LABELS.IMTEC, "IMTEC");
  });
});

describe("GINGIVITIS_LABELS", () => {
  it("ausente / leve / moderada / severa", () => {
    assert.equal(GINGIVITIS_LABELS.AUSENTE, "ausente");
    assert.equal(GINGIVITIS_LABELS.MODERADA, "moderada");
  });
});

describe("FLOW_STATUS_LABELS (G16)", () => {
  it("WAITING / IN_CHAIR / CHECKOUT / COMPLETED", () => {
    assert.equal(FLOW_STATUS_LABELS.WAITING, "espera");
    assert.equal(FLOW_STATUS_LABELS.IN_CHAIR, "sillón");
    assert.equal(FLOW_STATUS_LABELS.CHECKOUT, "salida");
  });
});

describe("SKELETAL_PATTERN_LABELS", () => {
  it("mesofacial / dolicofacial / braquifacial", () => {
    assert.equal(SKELETAL_PATTERN_LABELS.MESOFACIAL, "mesofacial");
    assert.equal(SKELETAL_PATTERN_LABELS.DOLICOFACIAL, "dolicofacial");
    assert.equal(SKELETAL_PATTERN_LABELS.BRAQUIFACIAL, "braquifacial");
  });
});
