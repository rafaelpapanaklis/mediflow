"use server";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H1/H3.

import { prisma } from "@/lib/prisma";
import type { CephPoints } from "@/lib/orthodontics/cefalometria/landmarks";
import type { CephMeasurements } from "@/lib/orthodontics/cefalometria/measurements";
import type { CephAnalysisType, CephNormSet } from "@/lib/orthodontics/cefalometria/norms";
import { isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "./_context";

export interface CephalometricAnalysisRow {
  id: string;
  kind: "INITIAL" | "PROGRESS" | "FINAL";
  analysisType: CephAnalysisType;
  normSet: CephNormSet;
  points: CephPoints;
  measurements: CephMeasurements;
  calibrationMmPerPixel: number | null;
  lateralXrayFileUrl: string | null;
  tracingPdfFileUrl: string | null;
  createdAt: string;
}

/** Self-fetch para la ranura de imagen y análisis — se calla (lista vacía) si no hay nada. */
export async function listCephalometricAnalyses(
  treatmentPlanId: string,
): Promise<ActionResult<CephalometricAnalysisRow[]>> {
  const auth = await getOrthoImagingContext(treatmentPlanId, { write: false });
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  try {
    const rows = await prisma.orthodonticCephalometryAnalysis.findMany({
      where: { treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        analysisType: true,
        normSet: true,
        points: true,
        measurements: true,
        calibrationMmPerPixel: true,
        lateralXrayFile: { select: { url: true } },
        tracingPdfFile: { select: { url: true } },
        createdAt: true,
      },
    });

    return ok(
      rows.map((r) => ({
        id: r.id,
        // kind/analysisType/normSet son String en la base (CHECK constraint,
        // no enum nativo — ver nota en schema.prisma) validados al escribir;
        // se afirman al tipo angosto de TS al leer.
        kind: r.kind as CephalometricAnalysisRow["kind"],
        analysisType: r.analysisType as CephAnalysisType,
        normSet: r.normSet as CephNormSet,
        points: (r.points as CephPoints) ?? {},
        measurements: (r.measurements as unknown as CephMeasurements) ?? {
          SNA: null,
          SNB: null,
          ANB: null,
          FMA: null,
          IMPA: null,
        },
        calibrationMmPerPixel: r.calibrationMmPerPixel,
        lateralXrayFileUrl: r.lateralXrayFile?.url ?? null,
        tracingPdfFileUrl: r.tracingPdfFile?.url ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (e) {
    if (isMissingRelation(e)) return ok([]);
    console.error("[ortho imagen] listCephalometricAnalyses failed:", e);
    return ok([]);
  }
}
