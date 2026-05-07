// Tests del predicate draftPayloadConsistent usado por saveTreatmentCardDraft.
// Cubre las invariantes de los hijos (elastics/IPR/brokenBrackets) ANTES de
// que el server las persista. La regla "no sobreescribir card SIGNED" se
// cubre con un fixture local porque vive dentro del transaction-scope.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { draftPayloadConsistent } from "../../../../../app/actions/orthodontics/_predicates";

describe("saveTreatmentCardDraft.draftPayloadConsistent", () => {
  it("acepta payload vacío (card en blanco)", () => {
    assert.equal(
      draftPayloadConsistent({
        elastics: [],
        iprPoints: [],
        brokenBrackets: [],
      }),
      true,
    );
  });

  it("acepta payload con todos los hijos válidos", () => {
    assert.equal(
      draftPayloadConsistent({
        elastics: [{ config: '1/4" 6oz' }, { config: '3/16" 4.5oz' }],
        iprPoints: [{ toothA: 13, toothB: 14, amountMm: 0.3 }],
        brokenBrackets: [{ toothFdi: 36, brokenDate: "2026-04-21" }],
      }),
      true,
    );
  });

  it("rechaza elastic con config vacío", () => {
    assert.equal(
      draftPayloadConsistent({
        elastics: [{ config: "" }],
        iprPoints: [],
        brokenBrackets: [],
      }),
      false,
    );
  });

  it("rechaza IPR con toothA === toothB (no hay 'self-IPR')", () => {
    assert.equal(
      draftPayloadConsistent({
        elastics: [],
        iprPoints: [{ toothA: 13, toothB: 13, amountMm: 0.2 }],
        brokenBrackets: [],
      }),
      false,
    );
  });

  it("rechaza IPR con cantidad ≤ 0 mm", () => {
    assert.equal(
      draftPayloadConsistent({
        elastics: [],
        iprPoints: [{ toothA: 13, toothB: 14, amountMm: 0 }],
        brokenBrackets: [],
      }),
      false,
    );
  });

  it("rechaza IPR con cantidad > 1.0 mm (límite seguro AAO)", () => {
    assert.equal(
      draftPayloadConsistent({
        elastics: [],
        iprPoints: [{ toothA: 13, toothB: 14, amountMm: 1.5 }],
        brokenBrackets: [],
      }),
      false,
    );
  });

  it("rechaza brokenBracket con FDI fuera de rango", () => {
    assert.equal(
      draftPayloadConsistent({
        elastics: [],
        iprPoints: [],
        brokenBrackets: [{ toothFdi: 99, brokenDate: "2026-04-21" }],
      }),
      false,
    );
  });

  it("rechaza brokenBracket sin fecha", () => {
    assert.equal(
      draftPayloadConsistent({
        elastics: [],
        iprPoints: [],
        brokenBrackets: [{ toothFdi: 36, brokenDate: "" }],
      }),
      false,
    );
  });
});
