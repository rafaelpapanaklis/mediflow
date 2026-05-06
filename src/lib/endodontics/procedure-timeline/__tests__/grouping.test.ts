// Endodontics — tests del groupPhotosBySession + phaseFromPhoto.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHASE_ORDER,
  extractCanalLabel,
  groupPhotosBySession,
  isCanalLabel,
  phaseFromPhoto,
  type ProcedurePhoto,
} from "../grouping";
import type { ClinicalPhotoStage, ClinicalPhotoType } from "@prisma/client";

function p(
  id: string,
  photoType: ClinicalPhotoType,
  stage: ClinicalPhotoStage,
  capturedAt: string,
): ProcedurePhoto {
  return {
    id,
    photoType,
    stage,
    blobUrl: `path/${id}.jpg`,
    thumbnailUrl: null,
    capturedAt,
    toothFdi: null,
    notes: null,
  };
}

describe("phaseFromPhoto", () => {
  it("endo_access → acceso (Roberto Salinas TC 36 — apertura cavidad)", () => {
    assert.equal(phaseFromPhoto({ photoType: "endo_access", stage: "during" }), "acceso");
  });
  it("endo_working_length → conductometria", () => {
    assert.equal(
      phaseFromPhoto({ photoType: "endo_working_length", stage: "during" }),
      "conductometria",
    );
  });
  it("endo_obturation → obturacion (Mariana Torres retx 21 — obturación final)", () => {
    assert.equal(
      phaseFromPhoto({ photoType: "endo_obturation", stage: "post" }),
      "obturacion",
    );
  });
  it("photoType=other con stage=during → preparacion", () => {
    assert.equal(phaseFromPhoto({ photoType: "other", stage: "during" }), "preparacion");
  });
  it("stage=control → control (Carlos Mendoza control 12m)", () => {
    assert.equal(phaseFromPhoto({ photoType: "other", stage: "control" }), "control");
  });
  it("stage=pre con photoType genérico → acceso", () => {
    assert.equal(phaseFromPhoto({ photoType: "other", stage: "pre" }), "acceso");
  });
});

describe("groupPhotosBySession", () => {
  it("agrupa por día y ordena cronológicamente (Roberto Salinas TC 36)", () => {
    const photos = [
      p("a", "endo_access", "pre", "2026-05-01T10:00:00Z"),
      p("b", "endo_working_length", "during", "2026-05-08T10:00:00Z"),
      p("c", "endo_obturation", "post", "2026-05-15T10:00:00Z"),
    ];
    const groups = groupPhotosBySession(photos);
    assert.equal(groups.length, 3);
    assert.equal(groups[0]!.sessionKey, "2026-05-01");
    assert.equal(groups[2]!.sessionKey, "2026-05-15");
  });

  it("orden de fases dentro de cada sesión = PHASE_ORDER", () => {
    const photos = [
      p("o", "endo_obturation", "post", "2026-05-01T15:00:00Z"),
      p("a", "endo_access", "during", "2026-05-01T10:00:00Z"),
    ];
    const groups = groupPhotosBySession(photos);
    assert.equal(
      groups[0]!.phases.map((x) => x.phase).join(","),
      PHASE_ORDER.join(","),
    );
  });

  it("totalPhotos suma fotos de todas las fases", () => {
    const photos = [
      p("a", "endo_access", "during", "2026-05-01T10:00:00Z"),
      p("b", "endo_working_length", "during", "2026-05-01T11:00:00Z"),
      p("c", "endo_obturation", "post", "2026-05-01T12:00:00Z"),
    ];
    const groups = groupPhotosBySession(photos);
    assert.equal(groups[0]!.totalPhotos, 3);
  });

  it("ordena fotos dentro de la fase por timestamp ascendente", () => {
    const photos = [
      p("late", "endo_access", "during", "2026-05-01T15:00:00Z"),
      p("early", "endo_access", "during", "2026-05-01T09:00:00Z"),
    ];
    const groups = groupPhotosBySession(photos);
    const acceso = groups[0]!.phases.find((x) => x.phase === "acceso")!;
    assert.deepEqual(acceso.photos.map((x) => x.id), ["early", "late"]);
  });

  it("Carlos Mendoza control 12m — sesión separada en fase control", () => {
    const groups = groupPhotosBySession([p("c1", "other", "control", "2027-05-01T10:00Z")]);
    assert.equal(groups[0]!.phases.find((x) => x.phase === "control")!.photos.length, 1);
  });
});

describe("isCanalLabel + extractCanalLabel", () => {
  it("acepta MV, ML, MB2, D", () => {
    for (const c of ["MV", "ML", "MB2", "D"]) assert.equal(isCanalLabel(c), true);
  });
  it("rechaza otras", () => {
    assert.equal(isCanalLabel("XX"), false);
    assert.equal(isCanalLabel(""), false);
  });
  it("extractCanalLabel encuentra el primer label válido en annotations", () => {
    assert.equal(
      extractCanalLabel([{ label: "ML" }, { label: "garbage" }]),
      "ML",
    );
  });
  it("extractCanalLabel regresa null si no hay match (Roberto Salinas con solo notas libres)", () => {
    assert.equal(extractCanalLabel([{ label: "lima 25/.04" }]), null);
    assert.equal(extractCanalLabel(null), null);
    assert.equal(extractCanalLabel(undefined), null);
  });
});
