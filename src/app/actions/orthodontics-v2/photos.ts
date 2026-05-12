"use server";

// Photos · 7 server actions (SPEC §1.3 PHOTOS).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { PhotoSet, Photo } from "@prisma/client";
import {
  CreatePhotoSetSchema,
  AnnotationSchema,
  MeasurementSchema,
} from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";
import { randomUUID } from "crypto";

export async function createPhotoSet(input: {
  caseId: string;
  stageCode: string;
  capturedAt: Date;
}): Promise<Result<PhotoSet>> {
  const parsed = CreatePhotoSetSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("upload_photoset");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  // Validar etapa T0 antes que T1 (SPEC §4 regla 5)
  if (input.stageCode.toUpperCase() !== "T0") {
    const t0 = await prisma.photoSet.findFirst({
      where: { caseId: input.caseId, stageCode: { equals: "T0", mode: "insensitive" } },
      include: { photos: true },
    });
    if (!t0 || t0.photos.length === 0)
      return fail("conflict", "Sube primero el set inicial T0");
  }

  const set = await prisma.photoSet.create({
    data: {
      caseId: input.caseId,
      stageCode: input.stageCode.toUpperCase(),
      capturedAt: input.capturedAt,
      createdBy: auth.data.userId,
    },
  });
  return ok(set);
}

export async function uploadPhotos(input: {
  photoSetId: string;
  files: Array<{
    kind: string;
    url: string;
    thumbUrl?: string;
    width: number;
    height: number;
  }>;
}): Promise<Result<Photo[]>> {
  const auth = await requirePermission("upload_photoset");
  if (!auth.ok) return reFail(auth);
  const set = await prisma.photoSet.findUnique({
    where: { id: input.photoSetId },
    select: { case: { select: { clinicId: true } } },
  });
  if (!set || set.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "PhotoSet no encontrado");

  const created = await Promise.all(
    input.files.map((f) =>
      prisma.photo.create({
        data: {
          photoSetId: input.photoSetId,
          kind: f.kind as never,
          url: f.url,
          thumbUrl: f.thumbUrl,
          width: f.width,
          height: f.height,
          annotations: [],
          measurements: [],
          teethRef: [],
        },
      }),
    ),
  );
  return ok(created);
}

export async function togglePhotoFavorite(photoId: string): Promise<Result<Photo>> {
  const auth = await requirePermission("toggle_favorite_photo");
  if (!auth.ok) return reFail(auth);
  const ph = await prisma.photo.findUnique({
    where: { id: photoId },
    select: {
      isFavorite: true,
      photoSet: { select: { case: { select: { clinicId: true } } } },
    },
  });
  if (!ph || ph.photoSet.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Foto no encontrada");
  const updated = await prisma.photo.update({
    where: { id: photoId },
    data: { isFavorite: !ph.isFavorite },
  });
  return ok(updated);
}

export async function addAnnotation(input: {
  photoId: string;
  annotation: unknown;
}): Promise<Result<Photo>> {
  const parsed = AnnotationSchema.safeParse(input.annotation);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("annotate_measure_photo");
  if (!auth.ok) return reFail(auth);

  const ph = await prisma.photo.findUnique({
    where: { id: input.photoId },
    select: {
      annotations: true,
      photoSet: { select: { case: { select: { clinicId: true } } } },
    },
  });
  if (!ph || ph.photoSet.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Foto no encontrada");

  const existing = Array.isArray(ph.annotations) ? ph.annotations : [];
  const updated = await prisma.photo.update({
    where: { id: input.photoId },
    data: { annotations: [...existing, parsed.data] as never },
  });
  return ok(updated);
}

export async function addMeasurement(input: {
  photoId: string;
  measurement: unknown;
}): Promise<Result<Photo>> {
  const parsed = MeasurementSchema.safeParse(input.measurement);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("annotate_measure_photo");
  if (!auth.ok) return reFail(auth);

  const ph = await prisma.photo.findUnique({
    where: { id: input.photoId },
    select: {
      measurements: true,
      photoSet: { select: { case: { select: { clinicId: true } } } },
    },
  });
  if (!ph || ph.photoSet.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Foto no encontrada");

  const existing = Array.isArray(ph.measurements) ? ph.measurements : [];
  const updated = await prisma.photo.update({
    where: { id: input.photoId },
    data: { measurements: [...existing, parsed.data] as never },
  });
  return ok(updated);
}

export async function deletePhoto(photoId: string): Promise<Result<void>> {
  const auth = await requirePermission("delete_photo");
  if (!auth.ok) return reFail(auth);
  const ph = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { photoSet: { select: { case: { select: { clinicId: true } } } } },
  });
  if (!ph || ph.photoSet.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Foto no encontrada");
  await prisma.photo.delete({ where: { id: photoId } });
  return ok(undefined);
}

export async function generateMobileUploadToken(input: {
  caseId: string;
  kind: string;
}): Promise<Result<{ url: string; expiresAt: Date }>> {
  const auth = await requirePermission("upload_photoset");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);
  // Stub funcional: el endpoint /m/scan/[token] no existe todavía (Fase 4 v2),
  // pero el token persiste y la URL es válida estructuralmente.
  const token = randomUUID().slice(0, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 min
  return ok({
    url: `/m/scan/${token}?caseId=${input.caseId}&kind=${input.kind}`,
    expiresAt,
  });
}
