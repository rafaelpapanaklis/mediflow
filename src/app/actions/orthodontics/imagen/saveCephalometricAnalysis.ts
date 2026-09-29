"use server";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H1/H3/H4.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { computeCephMeasurements } from "@/lib/orthodontics/cefalometria/measurements";
import type { CephPoints } from "@/lib/orthodontics/cefalometria/landmarks";
import { auditOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "./_context";

const ANALYSIS_TYPES = ["STEINER", "RICKETTS", "MCNAMARA"] as const;
const NORM_SETS = ["STANDARD", "MEXICAN"] as const;
const TRACING_KINDS = ["INITIAL", "PROGRESS", "FINAL"] as const;

export interface SaveCephalometricAnalysisInput {
  treatmentPlanId: string;
  /** Si se pasa, actualiza ese análisis en vez de crear uno nuevo. */
  analysisId?: string;
  kind: (typeof TRACING_KINDS)[number];
  analysisType: (typeof ANALYSIS_TYPES)[number];
  normSet: (typeof NORM_SETS)[number];
  points: CephPoints;
  calibrationMmPerPixel?: number | null;
  lateralXrayFileId?: string | null;
  tracingPdfFileId?: string | null;
}

function validate(input: SaveCephalometricAnalysisInput): string | null {
  if (!input.treatmentPlanId) return "Falta el caso de ortodoncia";
  if (!TRACING_KINDS.includes(input.kind)) return "Tipo de trazado inválido";
  if (!ANALYSIS_TYPES.includes(input.analysisType)) return "Análisis inválido";
  if (!NORM_SETS.includes(input.normSet)) return "Norma inválida";
  if (!input.points || typeof input.points !== "object") return "Puntos inválidos";
  return null;
}

/**
 * Crea o actualiza un análisis cefalométrico. Las medidas (SNA/SNB/ANB/
 * FMA/IMPA) SIEMPRE se recalculan en el servidor a partir de `points` —
 * nunca se confía en un número que mande el cliente.
 */
export async function saveCephalometricAnalysis(
  input: SaveCephalometricAnalysisInput,
): Promise<ActionResult<{ id: string; measurements: ReturnType<typeof computeCephMeasurements> }>> {
  const err = validate(input);
  if (err) return fail(err);

  const auth = await getOrthoImagingContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { ctx, patientId } = auth.data;

  // Los archivos que se ligan tienen que ser de ESTE paciente y de esta clínica
  // (el id llega del cliente): sin esto se podía colgar el archivo de otro.
  for (const fileId of [input.tracingPdfFileId, input.lateralXrayFileId]) {
    if (!fileId) continue;
    const archivo = await prisma.patientFile.findFirst({
      where: { id: fileId, clinicId: ctx.clinicId, patientId, deletedAt: null },
      select: { id: true },
    });
    if (!archivo) return fail("El archivo no es de este paciente");
  }

  const measurements = computeCephMeasurements(input.points);

  try {
    const data = {
      patientId,
      clinicId: ctx.clinicId,
      kind: input.kind,
      analysisType: input.analysisType,
      normSet: input.normSet,
      points: input.points as object,
      measurements: measurements as unknown as object,
      calibrationMmPerPixel: input.calibrationMmPerPixel ?? null,
      lateralXrayFileId: input.lateralXrayFileId ?? null,
      tracingPdfFileId: input.tracingPdfFileId ?? null,
    };

    let savedId: string;
    if (input.analysisId) {
      // updateMany: clinicId no es parte de la unique key de este modelo,
      // así que el filtro de tenant no cabe en un `where` de `update` directo.
      const { count } = await prisma.orthodonticCephalometryAnalysis.updateMany({
        where: { id: input.analysisId, clinicId: ctx.clinicId, treatmentPlanId: input.treatmentPlanId },
        data,
      });
      if (count === 0) return fail("Análisis cefalométrico no encontrado");
      savedId = input.analysisId;
    } else {
      const created = await prisma.orthodonticCephalometryAnalysis.create({
        data: { treatmentPlanId: input.treatmentPlanId, createdByUserId: ctx.userId, ...data },
        select: { id: true },
      });
      savedId = created.id;
    }
    const saved = { id: savedId };

    await auditOrtho({
      ctx,
      action: input.analysisId ? "ceph_analysis_updated" : "ceph_analysis_created",
      entityType: "OrthodonticCephalometryAnalysis",
      entityId: saved.id,
      patientId: patientId,
      after: { treatmentPlanId: input.treatmentPlanId, kind: input.kind, measurements },
    });

    revalidatePath(`/dashboard/patients/${patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${patientId}`);

    return ok({ id: saved.id, measurements });
  } catch (e) {
    if (isMissingRelation(e)) {
      return fail("La cefalometría todavía no está configurada en esta clínica (falta pegar el SQL)");
    }
    console.error("[ortho imagen] saveCephalometricAnalysis failed:", e);
    return fail("No se pudo guardar el análisis cefalométrico");
  }
}
