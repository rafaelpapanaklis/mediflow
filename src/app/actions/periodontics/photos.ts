// Periodontics — server actions: galería de fotos clínicas perio. SPEC §6, COMMIT 2.

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  PERIO_PHOTO_DEFAULT_STAGE,
  PERIO_PHOTO_KIND,
  PERIO_PHOTO_TYPE_TO_SCHEMA,
  type PerioPhotoKind,
} from "@/lib/periodontics/photo-types";
import {
  PERIO_AUDIT_ACTIONS,
  auditPerio,
  fail,
  getPerioActionContext,
  isFailure,
  loadPatientForPerio,
  ok,
  type ActionResult,
} from "./_helpers";

const PHOTO_STAGE = ["pre", "during", "post", "control"] as const;

const createPerioPhotoSchema = z.object({
  patientId: z.string().min(1),
  kind: z.enum(PERIO_PHOTO_KIND),
  blobUrl: z.string().url().max(2048),
  thumbnailUrl: z.string().url().max(2048).optional(),
  toothFdi: z
    .number()
    .int()
    .refine(
      (n) =>
        (n >= 11 && n <= 18) ||
        (n >= 21 && n <= 28) ||
        (n >= 31 && n <= 38) ||
        (n >= 41 && n <= 48),
      "FDI inválido",
    )
    .nullable()
    .optional(),
  stageOverride: z.enum(PHOTO_STAGE).optional(),
  notes: z.string().max(1000).optional(),
  capturedAt: z.coerce.date().optional(),
});

export async function createPerioPhoto(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createPerioPhotoSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const patient = await loadPatientForPerio({
    ctx,
    patientId: parsed.data.patientId,
  });
  if (isFailure(patient)) return patient;

  const stage = parsed.data.stageOverride ?? PERIO_PHOTO_DEFAULT_STAGE[parsed.data.kind];
  const photoType = PERIO_PHOTO_TYPE_TO_SCHEMA[parsed.data.kind];

  try {
    const created = await prisma.clinicalPhoto.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        module: "periodontics",
        toothFdi: parsed.data.toothFdi ?? null,
        photoType,
        stage,
        capturedAt: parsed.data.capturedAt ?? new Date(),
        capturedBy: ctx.userId,
        blobUrl: parsed.data.blobUrl,
        thumbnailUrl: parsed.data.thumbnailUrl ?? null,
        notes: parsed.data.notes ?? null,
      },
      select: { id: true },
    });

    await auditPerio({
      ctx,
      action: "perio.photo.created",
      entityType: "ClinicalPhoto",
      entityId: created.id,
      after: {
        kind: parsed.data.kind,
        photoType,
        stage,
        toothFdi: parsed.data.toothFdi ?? null,
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ id: created.id });
  } catch (e) {
    console.error("[perio photos] create failed:", e);
    return fail("No se pudo guardar la foto");
  }
}

const softDeleteSchema = z.object({ photoId: z.string().min(1) });

export async function softDeletePerioPhoto(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = softDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const photo = await prisma.clinicalPhoto.findFirst({
    where: {
      id: parsed.data.photoId,
      clinicId: ctx.clinicId,
      module: "periodontics",
      deletedAt: null,
    },
    select: { id: true, patientId: true, photoType: true, stage: true },
  });
  if (!photo) return fail("Foto no encontrada");

  try {
    await prisma.clinicalPhoto.update({
      where: { id: photo.id },
      data: { deletedAt: new Date() },
    });
    await auditPerio({
      ctx,
      action: "perio.photo.deleted",
      entityType: "ClinicalPhoto",
      entityId: photo.id,
      before: { photoType: photo.photoType, stage: photo.stage },
    });
    revalidatePath(`/dashboard/specialties/periodontics/${photo.patientId}`);
    return ok({ id: photo.id });
  } catch (e) {
    console.error("[perio photos] soft-delete failed:", e);
    return fail("No se pudo eliminar la foto");
  }
}
