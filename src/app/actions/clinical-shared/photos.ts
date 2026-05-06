"use server";
// Clinical-shared — server actions para ClinicalPhoto.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ClinicalModule, ClinicalPhotoStage, ClinicalPhotoType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { signMaybeUrl } from "@/lib/storage";
import { auditClinicalShared, guardPatient } from "@/lib/clinical-shared/auth/guard";
import {
  ALLOWED_PHOTO_MIME,
  MAX_PHOTO_BYTES,
  removeClinicalPhotoBinary,
  uploadClinicalPhoto,
} from "@/lib/clinical-shared/photos/storage";
import type { ClinicalPhotoDTO, PhotoAnnotation } from "@/lib/clinical-shared/photos/types";
import { fail, ok, isFailure, type ActionResult } from "@/lib/clinical-shared/result";

const moduleEnum = z.nativeEnum(ClinicalModule);
const photoTypeEnum = z.nativeEnum(ClinicalPhotoType);
const stageEnum = z.nativeEnum(ClinicalPhotoStage);

const annotationSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  label: z.string().min(1).max(120),
  color: z.string().max(20).optional(),
});

const uploadSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum,
  photoType: photoTypeEnum,
  stage: stageEnum,
  toothFdi: z.number().int().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  annotations: z.array(annotationSchema).max(20).optional(),
  contentType: z.string().min(1),
  fileName: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

export type UploadClinicalPhotoInput = z.infer<typeof uploadSchema> & {
  body: ArrayBuffer | Uint8Array;
};

/** Sube binario + crea row ClinicalPhoto. */
export async function uploadClinicalPhotoAction(
  input: UploadClinicalPhotoInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  if (!ALLOWED_PHOTO_MIME.has(parsed.data.contentType)) {
    return fail("Tipo de archivo no permitido");
  }
  if (parsed.data.size > MAX_PHOTO_BYTES) {
    return fail("La foto excede el tamaño máximo (8MB)");
  }

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  const { storagePath } = await uploadClinicalPhoto({
    clinicId: ctx.clinicId,
    patientId: parsed.data.patientId,
    module: parsed.data.module,
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    body: input.body,
  });

  const created = await prisma.clinicalPhoto.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module,
      photoType: parsed.data.photoType,
      stage: parsed.data.stage,
      toothFdi: parsed.data.toothFdi ?? null,
      capturedBy: ctx.userId,
      blobUrl: storagePath,
      thumbnailUrl: null,
      notes: parsed.data.notes ?? null,
      annotations: parsed.data.annotations
        ? (parsed.data.annotations as unknown as object)
        : undefined,
    },
    select: { id: true },
  });

  await auditClinicalShared({
    ctx,
    action: "clinical-shared.photo.uploaded",
    entityType: "clinical-photo",
    entityId: created.id,
    changes: { module: parsed.data.module, photoType: parsed.data.photoType },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok({ id: created.id });
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function deleteClinicalPhotoAction(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const photo = await prisma.clinicalPhoto.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true, blobUrl: true, deletedAt: true },
  });
  if (!photo || photo.deletedAt) return fail("Foto no encontrada");
  if (photo.clinicId !== ctx.clinicId) return fail("Sin acceso a esta foto");

  await prisma.clinicalPhoto.update({
    where: { id: photo.id },
    data: { deletedAt: new Date() },
  });
  await removeClinicalPhotoBinary(photo.blobUrl);

  await auditClinicalShared({
    ctx,
    action: "clinical-shared.photo.deleted",
    entityType: "clinical-photo",
    entityId: photo.id,
  });
  revalidatePath(`/dashboard/patients/${photo.patientId}`);
  return ok({ id: photo.id });
}

const listSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum.optional(),
  photoType: photoTypeEnum.optional(),
  stage: stageEnum.optional(),
});

export async function listClinicalPhotosAction(
  input: z.infer<typeof listSchema>,
): Promise<ActionResult<ClinicalPhotoDTO[]>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  const rows = await prisma.clinicalPhoto.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module ?? undefined,
      photoType: parsed.data.photoType ?? undefined,
      stage: parsed.data.stage ?? undefined,
      deletedAt: null,
    },
    orderBy: { capturedAt: "desc" },
    take: 200,
  });

  const dtos: ClinicalPhotoDTO[] = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      patientId: r.patientId,
      module: r.module,
      toothFdi: r.toothFdi,
      photoType: r.photoType,
      stage: r.stage,
      capturedAt: r.capturedAt.toISOString(),
      capturedBy: r.capturedBy,
      blobUrl: await signMaybeUrl(r.blobUrl),
      thumbnailUrl: r.thumbnailUrl ? await signMaybeUrl(r.thumbnailUrl) : null,
      notes: r.notes,
      annotations: (r.annotations as unknown as PhotoAnnotation[] | null) ?? null,
    })),
  );

  return ok(dtos);
}

const updateAnnotationsSchema = z.object({
  id: z.string().min(1),
  annotations: z.array(annotationSchema).max(20),
});

export async function updatePhotoAnnotationsAction(
  input: z.infer<typeof updateAnnotationsSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateAnnotationsSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const photo = await prisma.clinicalPhoto.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true, deletedAt: true },
  });
  if (!photo || photo.deletedAt) return fail("Foto no encontrada");
  if (photo.clinicId !== ctx.clinicId) return fail("Sin acceso");

  await prisma.clinicalPhoto.update({
    where: { id: photo.id },
    data: { annotations: parsed.data.annotations as unknown as object },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.photo.annotated",
    entityType: "clinical-photo",
    entityId: photo.id,
    changes: { count: parsed.data.annotations.length },
  });
  revalidatePath(`/dashboard/patients/${photo.patientId}`);
  return ok({ id: photo.id });
}
