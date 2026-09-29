"use server";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t10, H19). Guarda el
// análisis de fotos con líneas (línea E, ángulo nasolabial, línea media)
// del caso. Un registro por caso+vista: volver a marcar ACTUALIZA el
// mismo registro (no acumula historial), para que "reabrir" muestre
// siempre lo último marcado.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { computeFacialMeasurements } from "@/lib/orthodontics/fotos/facial-analysis";
import type { FacialPoints } from "@/lib/orthodontics/fotos/landmarks";
import { auditOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "./_context";
import type { FacialAnalysisView } from "./getFacialAnalysis";

const VIEWS: FacialAnalysisView[] = ["PERFIL", "FRENTE"];

export interface SaveFacialAnalysisInput {
  treatmentPlanId: string;
  view: FacialAnalysisView;
  points: FacialPoints;
  /** naturalWidth/naturalHeight de la foto en el momento de marcar. */
  imageWidth?: number | null;
  imageHeight?: number | null;
  calibrationPxPerMm?: number | null;
  photoFileId?: string | null;
}

function validate(input: SaveFacialAnalysisInput): string | null {
  if (!input.treatmentPlanId) return "Falta el caso de ortodoncia";
  if (!VIEWS.includes(input.view)) return "Vista inválida";
  if (!input.points || typeof input.points !== "object") return "Puntos inválidos";
  return null;
}

/** Crea o actualiza (por `treatmentPlanId` + `view`) el análisis facial guardado. */
export async function saveFacialAnalysis(
  input: SaveFacialAnalysisInput,
): Promise<ActionResult<{ id: string; measurements: ReturnType<typeof computeFacialMeasurements> }>> {
  const err = validate(input);
  if (err) return fail(err);

  const auth = await getOrthoImagingContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { ctx, patientId } = auth.data;

  // El archivo que se liga tiene que ser de ESTE paciente y de esta clínica: el
  // id llega del cliente (ahora también se puede elegir uno ya subido).
  if (input.photoFileId) {
    const archivo = await prisma.patientFile.findFirst({
      where: { id: input.photoFileId, clinicId: ctx.clinicId, patientId, deletedAt: null },
      select: { id: true },
    });
    if (!archivo) return fail("La foto no es de este paciente");
  }

  const measurements = computeFacialMeasurements(input.points, input.calibrationPxPerMm ?? undefined);

  try {
    const data = {
      patientId,
      clinicId: ctx.clinicId,
      points: input.points as object,
      imageWidth: input.imageWidth ?? null,
      imageHeight: input.imageHeight ?? null,
      measurements: measurements as unknown as object,
      calibrationPxPerMm: input.calibrationPxPerMm ?? null,
      photoFileId: input.photoFileId ?? null,
    };

    const saved = await prisma.orthodonticFacialAnalysis.upsert({
      where: { treatmentPlanId_view: { treatmentPlanId: input.treatmentPlanId, view: input.view } },
      create: { treatmentPlanId: input.treatmentPlanId, view: input.view, createdByUserId: ctx.userId, ...data },
      update: data,
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: "facial_analysis_saved",
      entityType: "OrthodonticFacialAnalysis",
      entityId: saved.id,
      after: { treatmentPlanId: input.treatmentPlanId, view: input.view, measurements },
    });

    revalidatePath(`/dashboard/patients/${patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${patientId}`);

    return ok({ id: saved.id, measurements });
  } catch (e) {
    if (isMissingRelation(e)) {
      return fail("El análisis de fotos todavía no está configurado en esta clínica (falta pegar el SQL)");
    }
    console.error("[ortho imagen] saveFacialAnalysis failed:", e);
    return fail("No se pudo guardar el análisis facial");
  }
}
