// Periodontics — tests para taxonomía de fotos perio. SPEC §6, COMMIT 2.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERIO_PHOTO_KIND,
  PERIO_PHOTO_TYPE_TO_SCHEMA,
  PERIO_PHOTO_LABEL,
  PERIO_PHOTO_DEFAULT_STAGE,
  PERIO_PHOTO_COMPARE_PAIRS,
  schemaPhotoTypeToPerioKind,
} from "../photo-types";

describe("PERIO_PHOTO_KIND", () => {
  it("expone exactamente 7 tipos perio (SPEC)", () => {
    assert.equal(PERIO_PHOTO_KIND.length, 7);
  });

  it("incluye los 7 slugs canónicos", () => {
    const expected = [
      "pre_srp",
      "post_srp",
      "pre_surgery",
      "post_surgery",
      "suture_removal",
      "maintenance_check",
      "gingival_recession_baseline",
    ].sort();
    const actual = [...PERIO_PHOTO_KIND].sort();
    assert.deepEqual(actual, expected);
  });
});

describe("PERIO_PHOTO_TYPE_TO_SCHEMA", () => {
  it("mapea cada slug perio a un valor del enum schema", () => {
    for (const kind of PERIO_PHOTO_KIND) {
      const schemaValue = PERIO_PHOTO_TYPE_TO_SCHEMA[kind];
      assert.ok(schemaValue, `falta mapeo para ${kind}`);
      assert.match(schemaValue, /^perio_/);
    }
  });

  it("post_srp reusa perio_postsrp del schema base (no duplica)", () => {
    assert.equal(PERIO_PHOTO_TYPE_TO_SCHEMA.post_srp, "perio_postsrp");
  });

  it("usa los nombres extendidos por la migración 20260505150000", () => {
    assert.equal(PERIO_PHOTO_TYPE_TO_SCHEMA.pre_srp, "perio_pre_srp");
    assert.equal(PERIO_PHOTO_TYPE_TO_SCHEMA.pre_surgery, "perio_pre_surgery");
    assert.equal(PERIO_PHOTO_TYPE_TO_SCHEMA.post_surgery, "perio_post_surgery");
    assert.equal(PERIO_PHOTO_TYPE_TO_SCHEMA.suture_removal, "perio_suture_removal");
    assert.equal(
      PERIO_PHOTO_TYPE_TO_SCHEMA.maintenance_check,
      "perio_maintenance_check",
    );
    assert.equal(
      PERIO_PHOTO_TYPE_TO_SCHEMA.gingival_recession_baseline,
      "perio_recession_baseline",
    );
  });
});

describe("schemaPhotoTypeToPerioKind", () => {
  it("invierte el mapa para tipos extendidos", () => {
    assert.equal(schemaPhotoTypeToPerioKind("perio_pre_srp"), "pre_srp");
    assert.equal(schemaPhotoTypeToPerioKind("perio_postsrp"), "post_srp");
    assert.equal(schemaPhotoTypeToPerioKind("perio_recession_baseline"), "gingival_recession_baseline");
  });

  it("devuelve null para tipos perio legacy no mapeados (perio_initial, perio_surgery)", () => {
    assert.equal(schemaPhotoTypeToPerioKind("perio_initial"), null);
    assert.equal(schemaPhotoTypeToPerioKind("perio_surgery"), null);
  });

  it("devuelve null para tipos no perio (eg. orto, endo)", () => {
    assert.equal(schemaPhotoTypeToPerioKind("ortho_progress"), null);
    assert.equal(schemaPhotoTypeToPerioKind("endo_obturation"), null);
  });
});

describe("PERIO_PHOTO_LABEL / DEFAULT_STAGE", () => {
  it("tiene etiqueta para cada kind", () => {
    for (const kind of PERIO_PHOTO_KIND) {
      assert.ok(PERIO_PHOTO_LABEL[kind], `falta label ${kind}`);
      assert.ok(PERIO_PHOTO_LABEL[kind].length > 0);
    }
  });

  it("asigna stage 'pre' a los pre-* y 'post' a los post-*", () => {
    assert.equal(PERIO_PHOTO_DEFAULT_STAGE.pre_srp, "pre");
    assert.equal(PERIO_PHOTO_DEFAULT_STAGE.post_srp, "post");
    assert.equal(PERIO_PHOTO_DEFAULT_STAGE.pre_surgery, "pre");
    assert.equal(PERIO_PHOTO_DEFAULT_STAGE.post_surgery, "post");
  });

  it("clasifica suture_removal y maintenance_check como 'control'", () => {
    assert.equal(PERIO_PHOTO_DEFAULT_STAGE.suture_removal, "control");
    assert.equal(PERIO_PHOTO_DEFAULT_STAGE.maintenance_check, "control");
  });
});

describe("PERIO_PHOTO_COMPARE_PAIRS", () => {
  it("define 4 pares de comparación pre/post", () => {
    assert.equal(PERIO_PHOTO_COMPARE_PAIRS.length, 4);
  });

  it("cada par usa slugs válidos de PERIO_PHOTO_KIND", () => {
    const known = new Set<string>(PERIO_PHOTO_KIND);
    for (const [a, b, label] of PERIO_PHOTO_COMPARE_PAIRS) {
      assert.ok(known.has(a), `slug desconocido: ${a}`);
      assert.ok(known.has(b), `slug desconocido: ${b}`);
      assert.ok(label.length > 0, "label vacía");
    }
  });

  it("incluye el par canónico antes/después de raspado", () => {
    const has = PERIO_PHOTO_COMPARE_PAIRS.some(
      ([a, b]) => a === "pre_srp" && b === "post_srp",
    );
    assert.ok(has, "falta par pre_srp/post_srp");
  });
});
