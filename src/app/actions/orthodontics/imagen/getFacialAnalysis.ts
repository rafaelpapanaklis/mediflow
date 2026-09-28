"use server";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t10, H19). Self-fetch para
// que PhotoLineAnalyzer pueda reabrir el análisis ya guardado de una vista
// (perfil/frente) del caso, con su foto y sus puntos en px naturales.

import { prisma } from "@/lib/prisma";
import { signMaybeUrls } from "@/lib/storage";
import type { FacialPoints } from "@/lib/orthodontics/fotos/landmarks";
import { computeFacialMeasurements, type FacialAnalysisMeasurements } from "@/lib/orthodontics/fotos/facial-analysis";
import { isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "./_context";

export type FacialAnalysisView = "PERFIL" | "FRENTE";

export interface FacialAnalysisRow {
  id: string;
  view: FacialAnalysisView;
  points: FacialPoints;
  imageWidth: number | null;
  imageHeight: number | null;
  measurements: FacialAnalysisMeasurements;
  calibrationPxPerMm: number | null;
  photoFileId: string | null;
  photoFileUrl: string | null;
  updatedAt: string;
}

/** Se calla (null) si no hay análisis guardado para esa vista, o si la tabla aún no existe. */
export async function getFacialAnalysis(
  treatmentPlanId: string,
  view: FacialAnalysisView,
): Promise<ActionResult<FacialAnalysisRow | null>> {
  const auth = await getOrthoImagingContext(treatmentPlanId, { write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  try {
    const row = await prisma.orthodonticFacialAnalysis.findFirst({
      where: { treatmentPlanId, clinicId: ctx.clinicId, view, deletedAt: null },
      select: {
        id: true,
        view: true,
        points: true,
        imageWidth: true,
        imageHeight: true,
        measurements: true,
        calibrationPxPerMm: true,
        photoFileId: true,
        photoFile: { select: { url: true } },
        updatedAt: true,
      },
    });
    if (!row) return ok(null);

    const [photoFileUrl] = await signMaybeUrls([row.photoFile?.url ?? null]);

    return ok({
      id: row.id,
      view: row.view as FacialAnalysisView,
      points: (row.points as FacialPoints) ?? {},
      imageWidth: row.imageWidth,
      imageHeight: row.imageHeight,
      measurements:
        (row.measurements as unknown as FacialAnalysisMeasurements | null) ??
        computeFacialMeasurements((row.points as FacialPoints) ?? {}, row.calibrationPxPerMm ?? undefined),
      calibrationPxPerMm: row.calibrationPxPerMm,
      photoFileId: row.photoFileId,
      photoFileUrl: photoFileUrl || null,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    if (isMissingRelation(e)) return ok(null);
    console.error("[ortho imagen] getFacialAnalysis failed:", e);
    return ok(null);
  }
}
