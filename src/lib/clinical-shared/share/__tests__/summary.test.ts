// clinical-shared/share — tests del summary corto orto.
// Tests unitarios del shape (no toca BD).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("buildShortOrthoSummary contract", () => {
  it("se exporta como función desde summary-orthodontics.ts", async () => {
    const mod = await import("../summary-orthodontics");
    assert.equal(typeof mod.buildShortOrthoSummary, "function");
  });

  it("OrthoShareStats tiene todos los campos esperados", async () => {
    const mod = await import("../summary-orthodontics");
    const dummy: import("../summary-orthodontics").OrthoShareStats = {
      monthInTreatment: 6,
      estimatedDurationMonths: 18,
      remainingMonths: 12,
      currentPhase: "ALIGNMENT",
      totalPhotoSets: 3,
      initialPhotoSetId: "ps1",
      lastPhotoSetId: "ps3",
      paymentStatus: "ON_TIME",
      technique: "BRACES_FIXED",
    };
    assert.equal(dummy.monthInTreatment, 6);
    assert.equal(dummy.totalPhotoSets, 3);
    assert.ok(typeof mod.buildShortOrthoSummary === "function");
  });
});
