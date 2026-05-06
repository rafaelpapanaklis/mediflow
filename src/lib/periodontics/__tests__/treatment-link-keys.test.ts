// Periodontics — tests para treatment-link-keys. SPEC §5, COMMIT 6.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERIO_TREATMENT_LINK_ENTITY,
  PERIO_TREATMENT_LINK_LABEL,
} from "../treatment-link-keys";

describe("PERIO_TREATMENT_LINK_ENTITY", () => {
  it("expone exactamente 3 entity keys: SRP, REEVALUATION, SURGERY", () => {
    const keys = Object.keys(PERIO_TREATMENT_LINK_ENTITY).sort();
    assert.deepEqual(keys, ["REEVALUATION", "SRP", "SURGERY"]);
  });

  it("usa prefijo perio- en todos los valores (estables en BD)", () => {
    for (const v of Object.values(PERIO_TREATMENT_LINK_ENTITY)) {
      assert.match(v, /^perio-/);
    }
  });

  it("tiene un label en español para cada entity", () => {
    for (const v of Object.values(PERIO_TREATMENT_LINK_ENTITY)) {
      assert.ok(
        PERIO_TREATMENT_LINK_LABEL[v],
        `falta label para ${v}`,
      );
    }
  });

  it("valores estables (los persiste TreatmentLink.moduleEntityType)", () => {
    assert.equal(PERIO_TREATMENT_LINK_ENTITY.SRP, "perio-srp");
    assert.equal(PERIO_TREATMENT_LINK_ENTITY.REEVALUATION, "perio-reevaluation");
    assert.equal(PERIO_TREATMENT_LINK_ENTITY.SURGERY, "perio-surgery");
  });
});
