"use server";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H1/H3.

import { prisma } from "@/lib/prisma";
import { signMaybeUrls } from "@/lib/storage";
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

    // El bucket es privado (BUCKETS.PATIENT_FILES — ver @/lib/storage): lo
    // que guarda `PatientFile.url` es el PATH interno, no algo que un
    // <img src> pueda cargar. Se firma bajo demanda, en UN solo viaje para
    // las hasta 2N URLs de todas las filas — mismo mecanismo que ya usa
    // `listMonitoringPhotos.ts` (H15) y `redesign/loader.ts` (fotos T0/T1/T2)
    // para lo mismo. Antes esta acción devolvía el path crudo tal cual: el
    // hallazgo de ws1-t11 (imagen en blanco) es este bug, no solo el
    // placeholder `/api/files/<id>` de los dos componentes que lo consumen.
    const rawUrls = rows.flatMap((r) => [r.lateralXrayFile?.url ?? null, r.tracingPdfFile?.url ?? null]);
    const signed = await signMaybeUrls(rawUrls);

    return ok(
      rows.map((r, i) => ({
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
        lateralXrayFileUrl: signed[i * 2] || null,
        tracingPdfFileUrl: signed[i * 2 + 1] || null,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (e) {
    if (isMissingRelation(e)) return ok([]);
    console.error("[ortho imagen] listCephalometricAnalyses failed:", e);
    return ok([]);
  }
}
