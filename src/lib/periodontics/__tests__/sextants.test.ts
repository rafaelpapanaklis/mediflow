// Periodontics — tests para sextantes (CPITN). SPEC §6, COMMIT 10.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SEXTANT_FDIS,
  SEXTANT_ORDER,
  computeSextantMetrics,
  diffSextants,
  fdiToSextant,
} from "../sextants";
import type { Site, ToothLevel } from "../schemas";

const site = (fdi: number, pdMm: number, bop = false): Site => ({
  fdi,
  position: "MV",
  pdMm,
  recMm: 0,
  bop,
  plaque: false,
  suppuration: false,
});

const tooth = (fdi: number, absent = false): ToothLevel => ({
  fdi,
  mobility: 0,
  furcation: 0,
  absent,
  isImplant: false,
});

describe("fdiToSextant / SEXTANT_FDIS", () => {
  it("clasifica los 32 dientes (incluye terceros molares)", () => {
    let count = 0;
    for (const fdis of Object.values(SEXTANT_FDIS)) count += fdis.length;
    assert.equal(count, 32);
  });

  it("11 → S2 (anterior superior)", () => {
    assert.equal(fdiToSextant(11), "S2");
  });

  it("31 → S5 (anterior inferior)", () => {
    assert.equal(fdiToSextant(31), "S5");
  });

  it("17 → S1 (sup derecho posterior)", () => {
    assert.equal(fdiToSextant(17), "S1");
  });

  it("28 (tercer molar sup izq) → S3", () => {
    assert.equal(fdiToSextant(28), "S3");
  });

  it("FDI inválido (eg. 51 temporal) → null", () => {
    assert.equal(fdiToSextant(51), null);
  });

  it("SEXTANT_ORDER tiene los 6 sextantes en orden CPITN", () => {
    assert.deepEqual([...SEXTANT_ORDER], ["S1", "S2", "S3", "S4", "S5", "S6"]);
  });
});

describe("computeSextantMetrics", () => {
  it("devuelve 6 sextantes incluso si no hay sitios", () => {
    const out = computeSextantMetrics([], []);
    assert.equal(out.length, 6);
    for (const s of out) {
      assert.equal(s.totalSites, 0);
      assert.equal(s.avgPd, 0);
      assert.equal(s.bopPct, 0);
      assert.equal(s.hasAnyTooth, false);
    }
  });

  it("calcula PD promedio y BoP% por sextante", () => {
    const sites = [
      site(11, 3, true),
      site(11, 4, false),
      site(21, 5, true),
      site(36, 6, true),
    ];
    const out = computeSextantMetrics(sites, []);
    const s2 = out.find((x) => x.sextant === "S2")!;
    assert.equal(s2.totalSites, 3);
    // (3+4+5)/3 = 4.0
    assert.equal(s2.avgPd, 4);
    // 2/3 con BoP = 66.7%
    assert.equal(s2.bopPct, 66.7);
    const s4 = out.find((x) => x.sextant === "S4")!;
    assert.equal(s4.totalSites, 1);
    assert.equal(s4.avgPd, 6);
  });

  it("excluye sitios de dientes ausentes", () => {
    const sites = [site(11, 5, true), site(11, 5, true), site(21, 3)];
    const teeth = [tooth(11, true)];
    const out = computeSextantMetrics(sites, teeth);
    const s2 = out.find((x) => x.sextant === "S2")!;
    // Solo cuenta el sitio del 21
    assert.equal(s2.totalSites, 1);
    assert.equal(s2.avgPd, 3);
    assert.equal(s2.bopPct, 0);
  });

  it("cuenta residualSites con PD≥5 + BoP+", () => {
    const sites = [
      site(36, 5, true), // residual
      site(36, 6, true), // residual
      site(36, 4, true), // no residual (PD<5)
      site(36, 6, false), // no residual (sin BoP)
    ];
    const out = computeSextantMetrics(sites, []);
    const s4 = out.find((x) => x.sextant === "S4")!;
    assert.equal(s4.residualSites, 2);
  });
});

describe("diffSextants", () => {
  const baseSite = (fdi: number, pdMm: number, bop = false) => site(fdi, pdMm, bop);

  it("clasifica como 'improved' si PD bajó ≥0.3mm", () => {
    const init = computeSextantMetrics([baseSite(11, 5, true), baseSite(21, 5, true)], []);
    const post = computeSextantMetrics([baseSite(11, 4, false), baseSite(21, 4, false)], []);
    const deltas = diffSextants(init, post);
    const s2 = deltas.find((d) => d.sextant === "S2")!;
    assert.ok(s2.avgPdDelta >= 0.3, `delta esperado >=0.3, fue ${s2.avgPdDelta}`);
    assert.equal(s2.trend, "improved");
  });

  it("clasifica como 'worsened' si PD subió ≥0.3mm", () => {
    const init = computeSextantMetrics([baseSite(11, 3), baseSite(21, 3)], []);
    const post = computeSextantMetrics([baseSite(11, 5), baseSite(21, 5)], []);
    const deltas = diffSextants(init, post);
    const s2 = deltas.find((d) => d.sextant === "S2")!;
    assert.equal(s2.trend, "worsened");
  });

  it("clasifica como 'stable' si cambios marginales", () => {
    const init = computeSextantMetrics([baseSite(11, 3), baseSite(21, 3)], []);
    const post = computeSextantMetrics([baseSite(11, 3), baseSite(21, 3)], []);
    const deltas = diffSextants(init, post);
    const s2 = deltas.find((d) => d.sextant === "S2")!;
    assert.equal(s2.trend, "stable");
  });

  it("'no_data' cuando ambos sextantes están sin dientes", () => {
    const init = computeSextantMetrics([], []);
    const post = computeSextantMetrics([], []);
    const deltas = diffSextants(init, post);
    for (const d of deltas) assert.equal(d.trend, "no_data");
  });

  it("clasifica improved por BoP aunque PD no cambie", () => {
    // PD igual, BoP baja de 100% a 0%.
    const init = computeSextantMetrics([baseSite(11, 3, true), baseSite(21, 3, true)], []);
    const post = computeSextantMetrics([baseSite(11, 3, false), baseSite(21, 3, false)], []);
    const deltas = diffSextants(init, post);
    const s2 = deltas.find((d) => d.sextant === "S2")!;
    assert.equal(s2.trend, "improved");
    assert.ok(s2.bopPctDelta >= 5);
  });
});
