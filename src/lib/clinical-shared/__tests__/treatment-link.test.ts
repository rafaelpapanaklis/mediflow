import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IMPLANT_TREATMENT_LINK_PHASES,
  isImplantTreatmentLinkPhase,
  implantPhaseLabel,
  implantPhaseToModuleEntityType,
  treatmentLinkUpsertSchema,
} from "../treatment-link";

describe("clinical-shared/treatment-link", () => {
  it("hay 5 phases implantológicas", () => {
    assert.equal(IMPLANT_TREATMENT_LINK_PHASES.length, 5);
  });

  it("isImplantTreatmentLinkPhase", () => {
    for (const p of IMPLANT_TREATMENT_LINK_PHASES) {
      assert.equal(isImplantTreatmentLinkPhase(p), true);
    }
    assert.equal(isImplantTreatmentLinkPhase("garbage"), false);
  });

  it("implantPhaseLabel español", () => {
    assert.equal(implantPhaseLabel("surgical"), "Cirugía de colocación");
    assert.equal(implantPhaseLabel("prosthetic"), "Fase protésica");
  });

  it("implantPhaseToModuleEntityType convención", () => {
    assert.equal(
      implantPhaseToModuleEntityType("surgical"),
      "implant-surgical-record",
    );
    assert.equal(
      implantPhaseToModuleEntityType("prosthetic"),
      "implant-prosthetic-phase",
    );
    assert.equal(
      implantPhaseToModuleEntityType("second_stage"),
      "implant-second-stage-surgery",
    );
  });

  it("treatmentLinkUpsertSchema valida campos", () => {
    const ok = treatmentLinkUpsertSchema.safeParse({
      moduleEntityType: "implant-surgical-record",
      moduleSessionId: "sr1",
      treatmentSessionId: "ts1",
    });
    assert.equal(ok.success, true);

    const fail = treatmentLinkUpsertSchema.safeParse({
      moduleEntityType: "",
      moduleSessionId: "sr1",
      treatmentSessionId: "ts1",
    });
    assert.equal(fail.success, false);
  });
});
