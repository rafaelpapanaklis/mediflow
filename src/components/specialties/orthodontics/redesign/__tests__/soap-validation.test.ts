// Tests de la regla "para firmar Treatment Card se requieren los 4 campos
// SOAP no vacíos". La lógica vive inline en el drawer; este test la replica
// como spec contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SOAP } from "../types";

function canSign(soap: SOAP): boolean {
  return (
    soap.s.trim().length > 0 &&
    soap.o.trim().length > 0 &&
    soap.a.trim().length > 0 &&
    soap.p.trim().length > 0
  );
}

describe("Treatment Card sign rule", () => {
  it("permite firmar con S/O/A/P todos llenos", () => {
    assert.equal(
      canSign({ s: "refiere molestia", o: "alineación ok", a: "evolución", p: "cita 4 sem" }),
      true,
    );
  });

  it("bloquea si S vacío", () => {
    assert.equal(canSign({ s: "", o: "x", a: "x", p: "x" }), false);
  });

  it("bloquea si O solo whitespace", () => {
    assert.equal(canSign({ s: "x", o: "   ", a: "x", p: "x" }), false);
  });

  it("bloquea si A vacío", () => {
    assert.equal(canSign({ s: "x", o: "x", a: "", p: "x" }), false);
  });

  it("bloquea si P vacío", () => {
    assert.equal(canSign({ s: "x", o: "x", a: "x", p: "" }), false);
  });

  it("permite firmar con strings con espacios y contenido", () => {
    assert.equal(
      canSign({ s: " a ", o: " b ", a: " c ", p: " d " }),
      true,
    );
  });
});
