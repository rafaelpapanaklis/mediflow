// Clinical-shared — tests para photo storage helpers (path building + sanitización).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_PHOTO_MIME, MAX_PHOTO_BYTES, buildPhotoPath } from "../storage";

describe("buildPhotoPath", () => {
  it("incluye prefix, clinicId, patientId, module y timestamp", () => {
    const path = buildPhotoPath({
      clinicId: "c1",
      patientId: "p1",
      module: "pediatrics",
      fileName: "foto.jpg",
    });
    assert.match(path, /^clinical-photos\/c1\/p1\/pediatrics\/\d+_foto\.jpg$/);
  });

  it("sanitiza fileName con caracteres no permitidos (path traversal)", () => {
    const path = buildPhotoPath({
      clinicId: "c1",
      patientId: "p1",
      module: "pediatrics",
      fileName: "../../etc/passwd",
    });
    assert.ok(!path.includes(".."), `path no debe contener ..: ${path}`);
    assert.ok(!path.includes("/etc/"), `path no debe contener /etc/: ${path}`);
  });

  it("recorta nombres muy largos a 80 chars", () => {
    const longName = "a".repeat(200) + ".jpg";
    const path = buildPhotoPath({
      clinicId: "c1",
      patientId: "p1",
      module: "pediatrics",
      fileName: longName,
    });
    const tail = path.split("/").at(-1)!;
    const afterTs = tail.replace(/^\d+_/, "");
    assert.ok(afterTs.length <= 80, `afterTs=${afterTs.length}`);
  });
});

describe("constantes", () => {
  it("MAX_PHOTO_BYTES = 8MB", () => {
    assert.equal(MAX_PHOTO_BYTES, 8 * 1024 * 1024);
  });

  it("MIME permitidos cubren los formatos web + heic", () => {
    assert.ok(ALLOWED_PHOTO_MIME.has("image/jpeg"));
    assert.ok(ALLOWED_PHOTO_MIME.has("image/png"));
    assert.ok(ALLOWED_PHOTO_MIME.has("image/webp"));
    assert.ok(ALLOWED_PHOTO_MIME.has("image/heic"));
    assert.ok(!ALLOWED_PHOTO_MIME.has("application/pdf"));
  });
});
