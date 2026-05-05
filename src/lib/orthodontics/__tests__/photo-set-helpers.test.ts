// Orthodontics — tests photo-set-helpers. SPEC §13.1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHOTO_VIEW_ORDER,
  availableSetTypes,
  isCompleteSet,
  missingViews,
} from "../photo-set-helpers";

const fullSet = {
  photoFrontalId: "f1",
  photoProfileId: "f2",
  photoSmileId: "f3",
  photoIntraFrontalId: "f4",
  photoIntraLateralRId: "f5",
  photoIntraLateralLId: "f6",
  photoOcclusalUpperId: "f7",
  photoOcclusalLowerId: "f8",
};

const emptySet = {
  photoFrontalId: null,
  photoProfileId: null,
  photoSmileId: null,
  photoIntraFrontalId: null,
  photoIntraLateralRId: null,
  photoIntraLateralLId: null,
  photoOcclusalUpperId: null,
  photoOcclusalLowerId: null,
};

describe("photo-set-helpers", () => {
  it("PHOTO_VIEW_ORDER tiene las 8 vistas", () => {
    assert.equal(PHOTO_VIEW_ORDER.length, 8);
  });

  it("isCompleteSet true cuando las 8 columnas tienen fileId", () => {
    assert.ok(isCompleteSet(fullSet));
  });

  it("isCompleteSet false cuando falta cualquier vista", () => {
    assert.ok(!isCompleteSet({ ...fullSet, photoFrontalId: null }));
    assert.ok(!isCompleteSet(emptySet));
  });

  it("missingViews lista las vistas faltantes en orden canónico", () => {
    const partial = { ...fullSet, photoFrontalId: null, photoSmileId: null };
    const missing = missingViews(partial);
    assert.deepEqual(missing, ["EXTRA_FRONTAL", "EXTRA_SMILE"]);
  });

  it("availableSetTypes: sin sets previos solo permite T0 + CONTROL", () => {
    const types = availableSetTypes(new Set<"T0" | "T1" | "T2" | "CONTROL">());
    assert.deepEqual(types, ["T0", "CONTROL"]);
  });

  it("availableSetTypes: con T0 ya creado permite T1, T2, CONTROL (no otro T0)", () => {
    const types = availableSetTypes(new Set<"T0" | "T1" | "T2" | "CONTROL">(["T0"]));
    assert.deepEqual(types, ["T1", "T2", "CONTROL"]);
  });

  it("availableSetTypes: con T0+T1 permite T2 + CONTROL (no T1 duplicado)", () => {
    const types = availableSetTypes(new Set<"T0" | "T1" | "T2" | "CONTROL">(["T0", "T1"]));
    assert.deepEqual(types, ["T2", "CONTROL"]);
  });

  it("availableSetTypes: con T0+T2 permite CONTROL solamente", () => {
    const types = availableSetTypes(new Set<"T0" | "T1" | "T2" | "CONTROL">(["T0", "T2"]));
    assert.deepEqual(types, ["CONTROL"]);
  });
});
