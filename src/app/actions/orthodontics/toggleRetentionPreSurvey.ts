"use server";
// Orthodontics — toggleRetentionPreSurvey. Sección G G9: activa/desactiva
// envío automático de pre-encuesta WhatsApp 1 día antes de cada control
// de retención.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  enabled: z.boolean(),
});

export async function toggleRetentionPreSurvey(
  input: unknown,
): Promise<ActionResult<{ enabled: boolean }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  try {
    const regimen = await prisma.orthoRetentionRegimen.upsert({
      where: { treatmentPlanId: plan.id },
      create: {
        treatmentPlanId: plan.id,
        clinicId: plan.clinicId,
        preSurveyEnabled: parsed.data.enabled,
      },
      update: { preSurveyEnabled: parsed.data.enabled },
      select: { id: true, preSurveyEnabled: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.RETENTION_PRE_SURVEY_TOGGLED,
      entityType: "OrthoRetentionRegimen",
      entityId: regimen.id,
      after: { enabled: parsed.data.enabled },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    return ok({ enabled: regimen.preSurveyEnabled });
  } catch (e) {
    console.error("[ortho] toggleRetentionPreSurvey failed:", e);
    return fail("No se pudo guardar la preferencia");
  }
}
