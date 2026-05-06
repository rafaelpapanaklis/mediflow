// Tests del documento PDF endodóntico — solo helpers puros (describePAI).
// El render del componente JSX se prueba en integración (route handler).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describePAI } from "../endodontics-export-document";

describe("describePAI", () => {
  it("regresa — para null/undefined", () => {
    assert.equal(describePAI(null), "—");
  });

  it("describe los 5 niveles de PAI Strindberg-Ørstavik (Carlos Mendoza control 12m)", () => {
    for (let i = 1; i <= 5; i++) {
      assert.match(describePAI(i), new RegExp(`PAI ${i}`));
    }
    assert.match(describePAI(1), /normales/);
    assert.match(describePAI(5), /severa/);
  });

  it("fallback genérico para PAI fuera de rango", () => {
    assert.equal(describePAI(7), "PAI 7");
  });
});
