// Tests del predicate canSignSoap usado por signTreatmentCard server action.
// Importamos del archivo de predicados puros (sin server-only imports).
//
// Fila 12 (sep-2026): para firmar solo el Plan (P) es obligatorio; S, O y A
// son opcionales. Antes se exigían los cuatro.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canSignSoap } from "../../../../../app/actions/orthodontics/_predicates";

describe("signTreatmentCard.canSignSoap", () => {
  it("permite firmar cuando los 4 campos SOAP tienen contenido", () => {
    assert.equal(
      canSignSoap({
        s: "refiere molestia leve",
        o: "alineación dentro de lo esperado",
        a: "evolución favorable",
        p: "control 4 sem · cambio a 0.018",
      }),
      true,
    );
  });

  it("permite firmar solo con el Plan (S, O y A vacíos)", () => {
    assert.equal(canSignSoap({ s: "", o: "", a: "", p: "control 4 sem" }), true);
  });

  it("S vacío ya no bloquea", () => {
    assert.equal(canSignSoap({ s: "", o: "x", a: "x", p: "x" }), true);
  });

  it("O solo whitespace ya no bloquea", () => {
    assert.equal(canSignSoap({ s: "x", o: "   ", a: "x", p: "x" }), true);
  });

  it("bloquea si P vacío aunque S/O/A estén llenos", () => {
    assert.equal(canSignSoap({ s: "x", o: "x", a: "x", p: "" }), false);
  });

  it("bloquea si P es solo whitespace", () => {
    assert.equal(canSignSoap({ s: "x", o: "x", a: "x", p: "\t\n " }), false);
  });

  it("permite firmar con strings con espacios y contenido", () => {
    assert.equal(canSignSoap({ s: " a ", o: " b ", a: " c ", p: " d " }), true);
  });
});
