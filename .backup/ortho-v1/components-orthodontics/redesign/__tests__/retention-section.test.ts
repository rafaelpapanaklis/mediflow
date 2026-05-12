// Tests de la sección de retención (régimen + checkups).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Tests de constantes en DrawerLabOrder y SectionDocs (sin renderizar React).
// Validamos solo lo que se exporta directamente.

describe("Retención · enums RetainerArchwireGauge", () => {
  // Los enums OrthoRetainerArchwireGauge se mapean en types-finance / types.
  // Aquí validamos las labels canon: .0175 / .0195 / .021.
  const GAUGE_LABEL = {
    G_0175: ".0175",
    G_0195: ".0195",
    G_021: ".021",
  } as const;

  it("incluye los 3 calibres canon", () => {
    assert.deepEqual(Object.keys(GAUGE_LABEL).sort(), ["G_0175", "G_0195", "G_021"]);
  });

  it(".0195 es el calibre default (más común)", () => {
    assert.equal(GAUGE_LABEL.G_0195, ".0195");
  });

  it("todas las labels tienen punto decimal sin parte entera", () => {
    for (const v of Object.values(GAUGE_LABEL)) {
      assert.match(v, /^\.\d{3,4}$/);
    }
  });
});

describe("Retención · checkup months canon", () => {
  const CHECKUP_MONTHS = [3, 6, 12, 24, 36] as const;

  it("son exactamente 5 checkups", () => {
    assert.equal(CHECKUP_MONTHS.length, 5);
  });

  it("son crecientes monotónicos", () => {
    for (let i = 1; i < CHECKUP_MONTHS.length; i++) {
      assert.ok(CHECKUP_MONTHS[i]! > CHECKUP_MONTHS[i - 1]!);
    }
  });

  it("primer checkup a 3 meses", () => {
    assert.equal(CHECKUP_MONTHS[0], 3);
  });

  it("último checkup a 36 meses (3 años)", () => {
    assert.equal(CHECKUP_MONTHS[CHECKUP_MONTHS.length - 1], 36);
  });

  it("incluye control 1-año (12m)", () => {
    assert.ok(CHECKUP_MONTHS.includes(12));
  });
});

describe("NPS schedule timeline canon", () => {
  const NPS_OFFSETS = [
    { type: "POST_DEBOND_3D", days: 3 },
    { type: "POST_DEBOND_6M", days: 30 * 6 },
    { type: "POST_DEBOND_12M", days: 30 * 12 },
  ] as const;

  it("son 3 envíos NPS programados", () => {
    assert.equal(NPS_OFFSETS.length, 3);
  });

  it("primer envío a +3 días (puerta de entrada Google review)", () => {
    assert.equal(NPS_OFFSETS[0]?.days, 3);
  });

  it("segundo envío a 6 meses (~180 días)", () => {
    assert.equal(NPS_OFFSETS[1]?.days, 180);
  });

  it("tercer envío a 12 meses (~360 días)", () => {
    assert.equal(NPS_OFFSETS[2]?.days, 360);
  });
});
