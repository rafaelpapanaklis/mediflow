// Tests de PHOTO_SLOTS canon (10 vistas AAO).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_SLOTS } from "../sections/PhotoSlotIcon";

describe("PHOTO_SLOTS canónico", () => {
  it("tiene exactamente 10 vistas (AAO standard)", () => {
    assert.equal(PHOTO_SLOTS.length, 10);
  });

  it("3 extraorales primero", () => {
    const first3 = PHOTO_SLOTS.slice(0, 3);
    for (const s of first3) assert.equal(s.group, "extraoral");
  });

  it("7 intraorales después", () => {
    const last7 = PHOTO_SLOTS.slice(3);
    assert.equal(last7.length, 7);
    for (const s of last7) assert.equal(s.group, "intraoral");
  });

  it("primera extraoral es 'Normal' (face-front)", () => {
    assert.equal(PHOTO_SLOTS[0]?.id, "normal");
    assert.equal(PHOTO_SLOTS[0]?.icon, "face-front");
  });

  it("incluye sobremordida y resalte (overbite + overjet)", () => {
    const ids = PHOTO_SLOTS.map((s) => s.id);
    assert.ok(ids.includes("sobremordida"));
    assert.ok(ids.includes("resalte"));
  });

  it("incluye laterales izq/der intraorales", () => {
    const ids = PHOTO_SLOTS.map((s) => s.id);
    assert.ok(ids.includes("lat_der"));
    assert.ok(ids.includes("lat_izq"));
  });

  it("incluye oclusal sup e inf", () => {
    const ids = PHOTO_SLOTS.map((s) => s.id);
    assert.ok(ids.includes("oclusal_sup"));
    assert.ok(ids.includes("oclusal_inf"));
  });

  it("todos los ids son strings únicos", () => {
    const ids = PHOTO_SLOTS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("todos los labels en español", () => {
    const labels = PHOTO_SLOTS.map((s) => s.label).join(" ");
    assert.match(labels, /Sonrisa|Lateral|Frontal|Sobremordida|Resalte|Oclusal/);
  });

  it("ids no incluyen espacios ni acentos (slug-friendly)", () => {
    for (const s of PHOTO_SLOTS) {
      assert.equal(s.id.includes(" "), false);
      assert.match(s.id, /^[a-z_]+$/);
    }
  });
});
