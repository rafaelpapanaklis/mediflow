// Tests de Sección H — post-tratamiento + NPS labels + referral codes.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("NPS_LABEL canon", () => {
  const NPS_LABEL = {
    POST_DEBOND_3D: "+3 días",
    POST_DEBOND_6M: "+6 meses",
    POST_DEBOND_12M: "+12 meses",
  } as const;

  it("3 entradas correspondientes a los enums DB", () => {
    assert.equal(Object.keys(NPS_LABEL).length, 3);
  });

  it("formato '+N <unidad>'", () => {
    for (const v of Object.values(NPS_LABEL)) {
      assert.match(v, /^\+\d+ (días|meses)/);
    }
  });

  it("3D usa días, 6M y 12M usan meses", () => {
    assert.match(NPS_LABEL.POST_DEBOND_3D, /días/);
    assert.match(NPS_LABEL.POST_DEBOND_6M, /meses/);
    assert.match(NPS_LABEL.POST_DEBOND_12M, /meses/);
  });
});

describe("Google review trigger threshold", () => {
  const triggerGoogleReview = (nps: number) => nps >= 9;

  it("dispara con NPS 10", () => {
    assert.equal(triggerGoogleReview(10), true);
  });

  it("dispara con NPS 9", () => {
    assert.equal(triggerGoogleReview(9), true);
  });

  it("NO dispara con NPS 8", () => {
    assert.equal(triggerGoogleReview(8), false);
  });

  it("NO dispara con NPS 7 (passive)", () => {
    assert.equal(triggerGoogleReview(7), false);
  });

  it("NO dispara con NPS 0 (detractor extremo)", () => {
    assert.equal(triggerGoogleReview(0), false);
  });
});

describe("Referral code validation regex", () => {
  const RX = /^[A-Z0-9_-]+$/;

  it("acepta código válido GABY26", () => {
    assert.equal(RX.test("GABY26"), true);
  });

  it("acepta con guión MARIA-2", () => {
    assert.equal(RX.test("MARIA-2"), true);
  });

  it("rechaza minúsculas", () => {
    assert.equal(RX.test("gaby26"), false);
  });

  it("rechaza espacios", () => {
    assert.equal(RX.test("GABY 26"), false);
  });

  it("rechaza acentos", () => {
    assert.equal(RX.test("MARÍA"), false);
  });

  it("acepta guion bajo", () => {
    assert.equal(RX.test("PAT_2026"), true);
  });
});
