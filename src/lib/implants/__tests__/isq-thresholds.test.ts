// Implants — tests umbrales ISQ. Spec §13.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateIsqForLoading } from "../isq-thresholds";

describe("evaluateIsqForLoading", () => {
  it("ISQ 74/72 → canLoad true (caso Roberto, BLX en 36)", () => {
    const r = evaluateIsqForLoading(74, 72);
    assert.equal(r.canLoad, true);
    assert.equal(r.zone, "ready");
    assert.equal(r.isqMin, 72);
  });

  it("ISQ 78/76 → canLoad true (osteointegración 8 sem confirmada)", () => {
    const r = evaluateIsqForLoading(78, 76);
    assert.equal(r.canLoad, true);
    assert.equal(r.zone, "ready");
  });

  it("ISQ 68/72 → canLoad false (mínima <70 zona límite)", () => {
    const r = evaluateIsqForLoading(68, 72);
    assert.equal(r.canLoad, false);
    assert.equal(r.zone, "borderline");
    assert.equal(r.isqMin, 68);
  });

  it("ISQ 70/70 → canLoad true (límite inferior exacto)", () => {
    const r = evaluateIsqForLoading(70, 70);
    assert.equal(r.canLoad, true);
    assert.equal(r.zone, "ready");
  });

  it("ISQ 50/85 → canLoad false unsafe (mínima <60)", () => {
    const r = evaluateIsqForLoading(50, 85);
    assert.equal(r.canLoad, false);
    assert.equal(r.zone, "unsafe");
    assert.equal(r.isqMin, 50);
  });

  it("ISQ 45/45 → canLoad false unsafe", () => {
    const r = evaluateIsqForLoading(45, 45);
    assert.equal(r.canLoad, false);
    assert.equal(r.zone, "unsafe");
  });

  it("ISQ 60/72 → canLoad false borderline (mínima exactamente en zona)", () => {
    const r = evaluateIsqForLoading(60, 72);
    assert.equal(r.canLoad, false);
    assert.equal(r.zone, "borderline");
  });
});
