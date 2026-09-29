"use server";
// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026). H14.
// Captura desde el LADO CLÍNICA (recepción/doctor), para el paciente que no
// usa el portal. La versión del portal del paciente vive en
// logElasticsComplianceFromPortal.ts (auth distinta: sesión de paciente).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditOrtho } from "../_helpers";
import { fail, isFailure, ok, type ActionResult } from "../result";
import { getOrthoImagingContext, isMissingRelation } from "../imagen/_context";

export interface LogElasticsComplianceInput {
  treatmentPlanId: string;
  logDate: string; // YYYY-MM-DD
  wornHours?: number | null;
  usedElastics: boolean;
  notes?: string | null;
}

function toDateOnly(logDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(logDate)) return null;
  const d = new Date(`${logDate}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Upsert por (treatmentPlanId, logDate) — un registro por día, capturado por recepción/doctor. */
export async function logElasticsCompliance(input: LogElasticsComplianceInput): Promise<ActionResult<{ id: string }>> {
  const date = toDateOnly(input.logDate);
  if (!date) return fail("Fecha inválida");

  const auth = await getOrthoImagingContext(input.treatmentPlanId);
  if (isFailure(auth)) return auth;
  const { ctx, patientId } = auth.data;

  try {
    const saved = await prisma.orthodonticElasticsLog.upsert({
      where: { treatmentPlanId_logDate: { treatmentPlanId: input.treatmentPlanId, logDate: date } },
      create: {
        treatmentPlanId: input.treatmentPlanId,
        patientId,
        clinicId: ctx.clinicId,
        logDate: date,
        wornHours: input.wornHours ?? null,
        usedElastics: input.usedElastics,
        source: "CLINIC_MANUAL",
        notes: input.notes ?? null,
      },
      update: {
        wornHours: input.wornHours ?? null,
        usedElastics: input.usedElastics,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: "elastics_log_manual",
      entityType: "OrthodonticElasticsLog",
      entityId: saved.id,
      patientId: patientId,
      after: { treatmentPlanId: input.treatmentPlanId, logDate: input.logDate, ...input },
    });

    revalidatePath(`/dashboard/patients/${patientId}/orthodontics`);

    return ok({ id: saved.id });
  } catch (e) {
    if (isMissingRelation(e)) {
      return fail("El cumplimiento de elásticos todavía no está configurado en esta clínica (falta pegar el SQL)");
    }
    console.error("[ortho alineadores] logElasticsCompliance failed:", e);
    return fail("No se pudo guardar el registro");
  }
}
