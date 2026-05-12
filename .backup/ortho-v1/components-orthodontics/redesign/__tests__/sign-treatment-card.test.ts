// Tests del predicate canSignSoap usado por signTreatmentCard server action.
// Importamos del archivo de predicados puros (sin server-only imports).

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

  it("bloquea firma cuando S está vacío", () => {
    assert.equal(canSignSoap({ s: "", o: "x", a: "x", p: "x" }), false);
  });

  it("bloquea firma cuando O solo contiene whitespace", () => {
    assert.equal(canSignSoap({ s: "x", o: "   ", a: "x", p: "x" }), false);
  });

  it("bloquea firma cuando A está vacío", () => {
    assert.equal(canSignSoap({ s: "x", o: "x", a: "", p: "x" }), false);
  });

  it("bloquea firma cuando P solo contiene tabs/newlines", () => {
    assert.equal(canSignSoap({ s: "x", o: "x", a: "x", p: "\t\n " }), false);
  });

  it("permite firma cuando los campos contienen espacios y contenido real", () => {
    assert.equal(
      canSignSoap({ s: " a ", o: " b ", a: " c ", p: " d " }),
      true,
    );
  });
});
