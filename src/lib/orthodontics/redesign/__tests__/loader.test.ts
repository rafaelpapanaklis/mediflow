// Tests del loader Fase 1 — focalizados en los helpers que no requieren BD.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Re-exporta para test (helpers internos del loader; los importamos del módulo).
const loader = await import("../loader");

describe("loader internals (smoke)", () => {
  it("exporta loadOrthoRedesignData como función async", () => {
    assert.equal(typeof loader.loadOrthoRedesignData, "function");
  });
});
