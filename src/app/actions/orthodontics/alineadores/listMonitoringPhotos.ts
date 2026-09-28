"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H15.
// Lado clínica: self-fetch de las fotos de monitoreo del caso, firmando la
// URL de storage bajo demanda (el bucket es privado).

import { prisma } from "@/lib/prisma";
import { createSignedFileUrl } from "@/lib/storage";
import { isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "../imagen/_context";

export interface MonitoringPhotoRow {
  id: string;
  url: string | null;
  fileName: string | null;
  angle: string;
  patientNote: string | null;
  doctorNote: string | null;
  reviewStatus: "PENDING" | "REVIEWED" | "FLAGGED";
  submittedAt: string;
}

export async function listMonitoringPhotos(treatmentPlanId: string): Promise<ActionResult<MonitoringPhotoRow[]>> {
  const auth = await getOrthoImagingContext(treatmentPlanId, { write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  try {
    const rows = await prisma.orthodonticMonitoringPhoto.findMany({
      where: { treatmentPlanId, clinicId: ctx.clinicId },
      orderBy: { submittedAt: "desc" },
      take: 60,
    });

    const withUrls = await Promise.all(
      rows.map(async (r) => {
        let url: string | null = null;
        try {
          url = await createSignedFileUrl(r.storageKey);
        } catch {
          url = null;
        }
        return {
          id: r.id,
          url,
          fileName: r.fileName,
          angle: r.angle,
          patientNote: r.patientNote,
          doctorNote: r.doctorNote,
          // reviewStatus es String en la base (CHECK constraint, no enum
          // nativo — ver nota en schema.prisma) validado al escribir.
          reviewStatus: r.reviewStatus as MonitoringPhotoRow["reviewStatus"],
          submittedAt: r.submittedAt.toISOString(),
        };
      }),
    );

    return ok(withUrls);
  } catch (e) {
    if (isMissingRelation(e)) return ok([]);
    console.error("[ortho alineadores] listMonitoringPhotos failed:", e);
    return ok([]);
  }
}
