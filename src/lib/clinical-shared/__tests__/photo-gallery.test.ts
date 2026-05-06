import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterPhotosByPatient,
  groupImplantPhotosByPhase,
  groupPhotosByStage,
  sortPhotosByDateDesc,
  isRadiographPhotoType,
  allowedPhotoTypesForModule,
  implantPhotoTypeToImplantPhase,
} from "../photo-gallery";
import type { ClinicalModule, ClinicalPhotoStage, ClinicalPhotoType } from "../types";

interface FakePhoto {
  module: ClinicalModule;
  patientId: string;
  photoType: ClinicalPhotoType;
  stage: ClinicalPhotoStage;
  capturedAt: Date;
  toothFdi: number | null;
}

const make = (overrides: Partial<FakePhoto> = {}): FakePhoto => ({
  module: "implants",
  patientId: "p1",
  photoType: "surgical_phase",
  stage: "during",
  capturedAt: new Date(2026, 0, 1),
  toothFdi: 36,
  ...overrides,
});

describe("clinical-shared/photo-gallery", () => {
  it("filterPhotosByPatient filtra por module + patientId", () => {
    const photos = [
      make({ module: "implants", patientId: "p1" }),
      make({ module: "implants", patientId: "p2" }),
      make({ module: "endodontics", patientId: "p1", photoType: "endo_access" }),
    ];
    const out = filterPhotosByPatient(photos, "implants", "p1");
    assert.equal(out.length, 1);
  });

  it("groupImplantPhotosByPhase ignora otros módulos", () => {
    const photos = [
      make({ photoType: "pre_surgical" }),
      make({ photoType: "surgical_phase" }),
      make({ photoType: "implant_healing" }),
      make({ photoType: "follow_up_radiograph" }),
      make({ module: "endodontics", photoType: "endo_access" }),
    ];
    const out = groupImplantPhotosByPhase(photos);
    assert.equal(out.planning.length, 1);
    assert.equal(out.surgical.length, 1);
    assert.equal(out.healing.length, 1);
    assert.equal(out.follow_up.length, 1);
  });

  it("groupPhotosByStage agrupa correctamente", () => {
    const photos = [
      make({ stage: "pre" }),
      make({ stage: "during" }),
      make({ stage: "during" }),
      make({ stage: "post" }),
    ];
    const out = groupPhotosByStage(photos);
    assert.equal(out.pre.length, 1);
    assert.equal(out.during.length, 2);
    assert.equal(out.post.length, 1);
    assert.equal(out.control.length, 0);
  });

  it("sortPhotosByDateDesc devuelve más reciente primero", () => {
    const a = make({ capturedAt: new Date(2026, 0, 1) });
    const b = make({ capturedAt: new Date(2026, 5, 1) });
    const out = sortPhotosByDateDesc([a, b]);
    assert.equal(out[0], b);
    assert.equal(out[1], a);
  });

  it("isRadiographPhotoType solo para follow_up_radiograph", () => {
    assert.equal(isRadiographPhotoType("follow_up_radiograph"), true);
    assert.equal(isRadiographPhotoType("surgical_phase"), false);
    assert.equal(isRadiographPhotoType("implant_placement"), false);
  });

  it("allowedPhotoTypesForModule (implants) incluye set v1 y v2", () => {
    const types = allowedPhotoTypesForModule("implants");
    assert.ok(types.includes("pre_surgical"));
    assert.ok(types.includes("surgical_phase"));
    assert.ok(types.includes("implant_placement"));
    assert.ok(types.includes("follow_up_radiograph"));
  });

  it("allowedPhotoTypesForModule (endodontics) NO incluye implant types", () => {
    const types = allowedPhotoTypesForModule("endodontics");
    assert.ok(!types.includes("pre_surgical"));
    assert.ok(types.includes("endo_access"));
  });

  it("implantPhotoTypeToImplantPhase reusa set v1", () => {
    assert.equal(implantPhotoTypeToImplantPhase("implant_site_pre"), "planning");
    assert.equal(implantPhotoTypeToImplantPhase("implant_placement"), "surgical");
    assert.equal(implantPhotoTypeToImplantPhase("implant_prosthetic"), "prosthetic");
  });

  it("implantPhotoTypeToImplantPhase para set v2", () => {
    assert.equal(implantPhotoTypeToImplantPhase("pre_surgical"), "planning");
    assert.equal(implantPhotoTypeToImplantPhase("surgical_phase"), "surgical");
    assert.equal(implantPhotoTypeToImplantPhase("second_stage"), "second_stage");
    assert.equal(implantPhotoTypeToImplantPhase("prosthetic_placement"), "prosthetic");
  });
});
