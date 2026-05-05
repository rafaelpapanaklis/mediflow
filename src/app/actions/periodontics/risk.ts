// Periodontics — server action: evaluación de riesgo Berna. SPEC §5.3

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createRiskAssessmentSchema } from "@/lib/periodontics/schemas";
import { computeBernaRisk } from "@/lib/periodontics/risk-berna";
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

/**
 * Crea una evaluación de riesgo periodontal usando 6 factores Berna y
 * persiste el resultado. Encola un recordatorio WhatsApp de mantenimiento
 * según `recommendedRecallMonths` (stub MVP — registra en audit, no envía
 * WA real hasta tener integración Twilio activa).
 */
export async function createRiskAssessment(
  input: unknown,
): Promise<
  ActionResult<{
    id: string;
    riskCategory: "BAJO" | "MODERADO" | "ALTO";
    recommendedRecallMonths: 3 | 4 | 6;
  }>
> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createRiskAssessmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  const { riskCategory, recommendedRecallMonths } = computeBernaRisk({
    bopPct: parsed.data.bopPct,
    residualSites5Plus: parsed.data.residualSites5Plus,
    lostTeethPerio: parsed.data.lostTeethPerio,
    boneLossAgeRatio: parsed.data.boneLossAgeRatio ?? undefined,
    smokingStatus: parsed.data.smokingStatus,
    hba1c: parsed.data.hba1c ?? undefined,
  });

  try {
    const created = await prisma.periodontalRiskAssessment.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        bopPct: parsed.data.bopPct,
        residualSites5Plus: parsed.data.residualSites5Plus,
        lostTeethPerio: parsed.data.lostTeethPerio,
        boneLossAgeRatio: parsed.data.boneLossAgeRatio ?? null,
        smokingStatus: parsed.data.smokingStatus,
        hba1c: parsed.data.hba1c ?? null,
        riskCategory,
        recommendedRecallMonths,
        evaluatedById: ctx.userId,
      },
      select: { id: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.RISK_ASSESSED,
      entityType: "PeriodontalRiskAssessment",
      entityId: created.id,
      after: {
        riskCategory,
        recommendedRecallMonths,
        bopPct: parsed.data.bopPct,
        residualSites5Plus: parsed.data.residualSites5Plus,
      },
    });

    // TODO v1.1: integrar con Twilio + cola de recordatorios real.
    // Por ahora dejamos rastro de auditoría con la intención.
    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.MAINTENANCE_SCHEDULED,
      entityType: "PeriodontalRiskAssessment",
      entityId: created.id,
      meta: {
        type: "PERIO",
        recommendedRecallMonths,
        patientId: parsed.data.patientId,
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ id: created.id, riskCategory, recommendedRecallMonths });
  } catch (e) {
    console.error("[perio risk] create failed:", e);
    return fail("No se pudo guardar la evaluación de riesgo");
  }
}
