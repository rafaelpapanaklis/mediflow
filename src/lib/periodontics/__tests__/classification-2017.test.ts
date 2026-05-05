// Periodontics — tests classifyPerio2017. SPEC §13.1
//
// Convención de fixtures: SALUD/GINGIVITIS usan recMm = -2 (encía cubre CEJ),
// porque la fórmula CAL = PD + REC del spec exige que la encía sana tenga
// recMm negativo para mantener CAL = 0. Para Estadios I-IV inducimos CAL
// específico vía override en sitios concretos.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPerio2017 } from "../classification-2017";
import type { Site, ToothLevel } from "../schemas";
import { FDI_ALL, SITE_CAPTURE_ORDER } from "../site-helpers";

function buildTeeth(opts: Partial<Record<number, Partial<ToothLevel>>> = {}): ToothLevel[] {
  return FDI_ALL.map((fdi) => ({
    fdi,
    mobility: 0,
    furcation: 0,
    absent: false,
    isImplant: false,
    ...(opts[fdi] ?? {}),
  }));
}

function buildSites(opts: {
  pdMm?: number;
  recMm?: number;
  bop?: boolean;
  override?: (fdi: number, position: Site["position"]) => Partial<Site>;
} = {}): Site[] {
  const out: Site[] = [];
  for (const fdi of FDI_ALL) {
    for (const position of SITE_CAPTURE_ORDER) {
      out.push({
        fdi,
        position,
        pdMm: opts.pdMm ?? 2,
        recMm: opts.recMm ?? -2,
        bop: opts.bop ?? false,
        plaque: false,
        suppuration: false,
        ...(opts.override?.(fdi, position) ?? {}),
      });
    }
  }
  return out;
}

const NO_MODS = { modifiers: {} };

describe("classifyPerio2017", () => {
  it("clasifica salud cuando todos los sitios PD ≤3 y BoP <10%", () => {
    const out = classifyPerio2017({
      sites: buildSites({ pdMm: 2, recMm: -2, bop: false }),
      toothLevel: buildTeeth(),
      patientAge: 35,
      ...NO_MODS,
    });
    assert.equal(out.stage, "SALUD");
    assert.equal(out.grade, null);
    assert.equal(out.extension, null);
  });

  it("clasifica gingivitis cuando BoP ≥10% pero CAL = 0", () => {
    const out = classifyPerio2017({
      sites: buildSites({ pdMm: 3, recMm: -3, bop: true }),
      toothLevel: buildTeeth(),
      patientAge: 30,
      ...NO_MODS,
    });
    assert.equal(out.stage, "GINGIVITIS");
    assert.equal(out.grade, null);
  });

  it("clasifica Estadio I cuando max CAL interproximal 1-2mm", () => {
    // 1 sitio interproximal con CAL=2 (PD=2, REC=0); resto sano (CAL=0).
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) => (fdi === 16 && pos === "MV" ? { pdMm: 2, recMm: 0 } : {}),
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: buildTeeth(),
      patientAge: 40,
      ...NO_MODS,
    });
    assert.equal(out.stage, "STAGE_I");
    assert.equal(out.inputs.maxCalInterproximalMm, 2);
  });

  it("clasifica Estadio II cuando max CAL 3-4mm", () => {
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) => (fdi === 16 && pos === "DV" ? { pdMm: 2, recMm: 2 } : {}),
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: buildTeeth(),
      patientAge: 45,
      ...NO_MODS,
    });
    assert.equal(out.stage, "STAGE_II");
    assert.equal(out.inputs.maxCalInterproximalMm, 4);
  });

  it("clasifica Estadio III cuando max CAL ≥5mm sin complejidad alta", () => {
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) => (fdi === 16 && pos === "DV" ? { pdMm: 3, recMm: 3 } : {}),
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: buildTeeth(),
      patientAge: 50,
      ...NO_MODS,
    });
    assert.equal(out.stage, "STAGE_III");
    assert.ok(out.inputs.maxCalInterproximalMm >= 5);
  });

  it("clasifica Estadio IV cuando max CAL ≥5 + ≥5 dientes perdidos", () => {
    const lostFdis = [18, 17, 16, 26, 27];
    const teeth = buildTeeth(Object.fromEntries(lostFdis.map((f) => [f, { absent: true }])));
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) => (fdi === 36 && pos === "DV" ? { pdMm: 4, recMm: 2 } : {}),
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: teeth,
      patientAge: 60,
      ...NO_MODS,
    });
    assert.equal(out.stage, "STAGE_IV");
    assert.ok(out.inputs.lostTeethPerio >= 5);
    assert.ok(out.inputs.complexityFactors.includes("≥5 dientes perdidos"));
  });

  it("grado C por boneLossAgeRatio >1.0", () => {
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) => (fdi === 16 && pos === "DV" ? { pdMm: 3, recMm: 3 } : {}),
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: buildTeeth(),
      patientAge: 30,
      boneLossPct: 60, // 60/30 = 2.0 > 1.0 → GRADE_C
      modifiers: {},
    });
    assert.equal(out.grade, "GRADE_C");
    assert.equal(out.inputs.boneLossAgeRatio, 2);
  });

  it("sube grado de B a C cuando smokingCigsPerDay ≥10", () => {
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) => (fdi === 16 && pos === "DV" ? { pdMm: 3, recMm: 3 } : {}),
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: buildTeeth(),
      patientAge: 50,
      // sin boneLossPct → default GRADE_B → bump por tabaquismo → GRADE_C
      modifiers: { smokingCigsPerDay: 15 },
    });
    assert.equal(out.grade, "GRADE_C");
  });

  it("sube grado de A a B cuando hba1c ≥7", () => {
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) => (fdi === 16 && pos === "DV" ? { pdMm: 3, recMm: 3 } : {}),
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: buildTeeth(),
      patientAge: 60,
      boneLossPct: 10, // 10/60 ≈ 0.17 → GRADE_A
      modifiers: { hba1c: 7.5 },
    });
    assert.equal(out.grade, "GRADE_B");
  });

  it("detecta patrón molar/incisivo cuando solo molares e incisivos afectados", () => {
    const affected = new Set([16, 26, 36, 11, 31]);
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) =>
        affected.has(fdi) && pos === "DV" ? { pdMm: 3, recMm: 3 } : {},
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: buildTeeth(),
      patientAge: 25,
      ...NO_MODS,
    });
    assert.equal(out.extension, "PATRON_MOLAR_INCISIVO");
  });

  it("excluye dientes ausentes del denominador de affectedTeethPct", () => {
    const teeth = buildTeeth({ 18: { absent: true }, 28: { absent: true } });
    const sites = buildSites({
      pdMm: 2,
      recMm: -2,
      override: (fdi, pos) => (fdi === 16 && pos === "DV" ? { pdMm: 3, recMm: 3 } : {}),
    });
    const out = classifyPerio2017({
      sites,
      toothLevel: teeth,
      patientAge: 50,
      ...NO_MODS,
    });
    // 1 diente afectado / 30 presentes ≈ 3.3% → localizada
    assert.ok(out.inputs.affectedTeethPct < 30);
    assert.equal(out.extension, "LOCALIZADA");
  });
});
