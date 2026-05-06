// Periodontics — tests para photo-compare. SPEC §6, COMMIT 13.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPerioComparePairs, parseAnnotations } from "../photo-compare";
import type { PerioPhotoListItem } from "../photo-load";
import type { PerioPhotoKind } from "../photo-types";

const photo = (
  id: string,
  kind: PerioPhotoKind | null,
  capturedAt: string,
  toothFdi: number | null = null,
): PerioPhotoListItem => ({
  id,
  kind,
  stage: "pre",
  blobUrl: `https://example.com/${id}.jpg`,
  thumbnailUrl: null,
  toothFdi,
  notes: null,
  capturedAt: new Date(capturedAt),
});

describe("buildPerioComparePairs", () => {
  it("devuelve [] cuando no hay fotos", () => {
    assert.deepEqual(buildPerioComparePairs([]), []);
  });

  it("incluye el par pre_srp/post_srp cuando ambas fotos existen", () => {
    const photos = [
      photo("a", "pre_srp", "2026-01-01"),
      photo("b", "post_srp", "2026-02-15"),
    ];
    const pairs = buildPerioComparePairs(photos);
    const srp = pairs.find((p) => p.beforeKind === "pre_srp" && p.afterKind === "post_srp");
    assert.ok(srp);
    assert.equal(srp.before?.id, "a");
    assert.equal(srp.after?.id, "b");
  });

  it("elige la foto MÁS RECIENTE de cada kind", () => {
    const photos = [
      photo("a-old", "pre_srp", "2026-01-01"),
      photo("a-new", "pre_srp", "2026-03-10"),
      photo("b", "post_srp", "2026-04-15"),
    ];
    const pairs = buildPerioComparePairs(photos);
    const srp = pairs.find((p) => p.beforeKind === "pre_srp")!;
    assert.equal(srp.before?.id, "a-new");
  });

  it("incluye pares con solo UNA foto disponible", () => {
    const photos = [photo("a", "pre_srp", "2026-01-01")];
    const pairs = buildPerioComparePairs(photos);
    const srp = pairs.find((p) => p.beforeKind === "pre_srp")!;
    assert.equal(srp.before?.id, "a");
    assert.equal(srp.after, null);
  });

  it("omite pares completamente vacíos", () => {
    const photos = [photo("only", "maintenance_check", "2026-01-01")];
    const pairs = buildPerioComparePairs(photos);
    // maintenance_check no participa en ningún par predefinido.
    assert.equal(pairs.length, 0);
  });

  it("filtra por toothFdi cuando se provee", () => {
    const photos = [
      photo("d11-pre", "pre_srp", "2026-01-01", 11),
      photo("d11-post", "post_srp", "2026-02-01", 11),
      photo("d21-pre", "pre_srp", "2026-01-15", 21),
    ];
    const pairs = buildPerioComparePairs(photos, { toothFdi: 11 });
    const srp = pairs.find((p) => p.beforeKind === "pre_srp")!;
    assert.equal(srp.before?.id, "d11-pre");
    assert.equal(srp.after?.id, "d11-post");
  });

  it("ignora fotos con kind=null (legacy unmapped)", () => {
    const photos = [photo("legacy", null, "2026-01-01")];
    const pairs = buildPerioComparePairs(photos);
    assert.equal(pairs.length, 0);
  });
});

describe("parseAnnotations", () => {
  it("acepta anotaciones válidas", () => {
    const raw = [
      { x: 0.1, y: 0.2, label: "Recesión 3mm" },
      { x: 0.5, y: 0.5, label: "Bolsa", color: "#f00" },
    ];
    const out = parseAnnotations(raw);
    assert.equal(out.length, 2);
    assert.equal(out[0].label, "Recesión 3mm");
    assert.equal(out[1].color, "#f00");
  });

  it("descarta anotaciones con coords fuera de 0..1", () => {
    const raw = [
      { x: 1.2, y: 0.5, label: "out" },
      { x: 0.5, y: -0.1, label: "out" },
      { x: 0.5, y: 0.5, label: "valid" },
    ];
    const out = parseAnnotations(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].label, "valid");
  });

  it("descarta entradas con shape inválido", () => {
    const raw = [
      { x: "0.5", y: 0.5, label: "no-number" },
      { x: 0.5, y: 0.5 }, // sin label
      "string",
      null,
    ];
    const out = parseAnnotations(raw);
    assert.equal(out.length, 0);
  });

  it("devuelve [] si raw no es array", () => {
    assert.deepEqual(parseAnnotations(null), []);
    assert.deepEqual(parseAnnotations({}), []);
    assert.deepEqual(parseAnnotations("foo"), []);
  });
});
