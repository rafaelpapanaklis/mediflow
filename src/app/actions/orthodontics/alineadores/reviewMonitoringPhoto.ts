"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H15.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "../imagen/_context";

const STATUSES = ["REVIEWED", "FLAGGED"] as const;

export interface ReviewMonitoringPhotoInput {
  photoId: string;
  treatmentPlanId: string;
  reviewStatus: (typeof STATUSES)[number];
  doctorNote?: string | null;
}

export async function reviewMonitoringPhoto(input: ReviewMonitoringPhotoInput): Promise<ActionResult<{ id: string }>> {
  if (!STATUSES.includes(input.reviewStatus)) return fail("Estado inválido");

  const auth = await getOrthoImagingContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { ctx, patientId } = auth.data;

  try {
    // updateMany en vez de update: el filtro de tenant (clinicId) no es
    // parte de la unique key de este modelo, así que no cabe en un `where`
    // de `update` directo.
    const { count } = await prisma.orthodonticMonitoringPhoto.updateMany({
      where: { id: input.photoId, clinicId: ctx.clinicId, treatmentPlanId: input.treatmentPlanId },
      data: {
        reviewStatus: input.reviewStatus,
        doctorNote: input.doctorNote ?? null,
        reviewedByUserId: ctx.userId,
        reviewedAt: new Date(),
      },
    });
    if (count === 0) return fail("Foto de monitoreo no encontrada");

    await auditOrtho({
      ctx,
      action: "monitoring_photo_reviewed",
      entityType: "OrthodonticMonitoringPhoto",
      entityId: input.photoId,
      patientId: patientId,
      after: { reviewStatus: input.reviewStatus },
    });

    revalidatePath(`/dashboard/patients/${patientId}/orthodontics`);

    return ok({ id: input.photoId });
  } catch (e) {
    if (isMissingRelation(e)) return fail("El monitoreo con fotos todavía no está configurado en esta clínica");
    console.error("[ortho alineadores] reviewMonitoringPhoto failed:", e);
    return fail("No se pudo actualizar la revisión");
  }
}
