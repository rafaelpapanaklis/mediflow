"use server";
// Ortodoncia — H58: guarda y reabre las medidas de Bolton del caso. Un
// registro por caso; guardar de nuevo lo reemplaza.

import { prisma } from "@/lib/prisma";
import { isFailure, fail, ok, type ActionResult } from "../result";
import { auditOrtho } from "../_helpers";
import { getOrthoImagingContext, isMissingRelation } from "./_context";

export interface BoltonGuardado {
  widths: Record<string, number>;
  upperSpaceMm: number | null;
  lowerSpaceMm: number | null;
  updatedAt: string;
}

/** Anchos válidos: número finito de 0 a 20 mm (un diente no mide más). */
export async function limpiarAnchos(raw: unknown): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const fdi = Number(k);
    if (!Number.isInteger(fdi) || fdi < 11 || fdi > 48) continue;
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 20) out[String(fdi)] = v;
  }
  return out;
}

export async function getBoltonAnalysis(treatmentPlanId: string): Promise<ActionResult<BoltonGuardado | null>> {
  const auth = await getOrthoImagingContext(treatmentPlanId, { write: false });
  if (isFailure(auth)) return auth;
  try {
    const row = await prisma.orthodonticBoltonAnalysis.findFirst({
      where: { treatmentPlanId, clinicId: auth.data.ctx.clinicId },
    });
    if (!row) return ok(null);
    return ok({
      widths: (row.widths as Record<string, number>) ?? {},
      upperSpaceMm: row.upperSpaceMm,
      lowerSpaceMm: row.lowerSpaceMm,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (e) {
    if (!isMissingRelation(e)) console.error("[ortho imagen] getBoltonAnalysis failed:", e);
    return ok(null);
  }
}

export async function saveBoltonAnalysis(input: {
  treatmentPlanId: string;
  widths: Record<string, number>;
  upperSpaceMm: number | null;
  lowerSpaceMm: number | null;
}): Promise<ActionResult<{ saved: true }>> {
  const auth = await getOrthoImagingContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { ctx, patientId } = auth.data;
  const widths = await limpiarAnchos(input.widths);
  const espacio = (v: number | null) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100 ? v : null);
  try {
    const data = {
      widths: widths as object,
      upperSpaceMm: espacio(input.upperSpaceMm),
      lowerSpaceMm: espacio(input.lowerSpaceMm),
    };
    await prisma.orthodonticBoltonAnalysis.upsert({
      where: { treatmentPlanId: input.treatmentPlanId },
      create: {
        treatmentPlanId: input.treatmentPlanId,
        patientId,
        clinicId: ctx.clinicId,
        createdByUserId: ctx.userId,
        ...data,
      },
      update: data,
    });
    await auditOrtho({
      ctx,
      action: "ortho.bolton.saved",
      entityType: "OrthodonticBoltonAnalysis",
      entityId: input.treatmentPlanId,
      patientId,
      meta: { treatmentPlanId: input.treatmentPlanId },
    });
    return ok({ saved: true });
  } catch (e) {
    if (isMissingRelation(e)) return fail("Falta pegar el SQL de Bolton (sql/ortodoncia-bolton.sql) para guardar.");
    console.error("[ortho imagen] saveBoltonAnalysis failed:", e);
    return fail("No se pudieron guardar las medidas");
  }
}
