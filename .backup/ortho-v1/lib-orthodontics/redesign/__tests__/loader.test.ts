// Tests del loader Fase 1 — focalizados en los helpers que no requieren BD.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("loader internals (smoke)", () => {
  it("exporta loadOrthoRedesignData como función async", async () => {
    const loader = await import("../loader");
    assert.equal(typeof loader.loadOrthoRedesignData, "function");
  });
});
