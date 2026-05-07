"use server";
// Orthodontics — selectQuoteScenario. ModalOpenChoice G5: doctor escoge
// uno de 3 escenarios → marcamos accepted y los otros rejected.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  scenarioId: z.string().uuid(),
});

export async function selectQuoteScenario(
  input: unknown,
): Promise<ActionResult<{ scenarioId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const scenario = await prisma.orthoQuoteScenario.findFirst({
    where: {
      id: parsed.data.scenarioId,
      treatmentPlanId: parsed.data.treatmentPlanId,
      clinicId: ctx.clinicId,
    },
    select: { id: true, treatmentPlanId: true },
  });
  if (!scenario) return fail("Escenario no encontrado");

  try {
    const now = new Date();
    await prisma.$transaction([
      prisma.orthoQuoteScenario.updateMany({
        where: {
          treatmentPlanId: parsed.data.treatmentPlanId,
          clinicId: ctx.clinicId,
          id: { not: scenario.id },
          status: { in: ["DRAFT", "PRESENTED"] },
        },
        data: { status: "REJECTED", rejectedAt: now },
      }),
      prisma.orthoQuoteScenario.update({
        where: { id: scenario.id },
        data: { status: "ACCEPTED", acceptedAt: now, presentedAt: now },
      }),
    ]);

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.QUOTE_SCENARIO_SELECTED,
      entityType: "OrthoQuoteScenario",
      entityId: scenario.id,
      after: { status: "ACCEPTED" },
    });

    const plan = await prisma.orthodonticTreatmentPlan.findUnique({
      where: { id: parsed.data.treatmentPlanId },
      select: { patientId: true },
    });
    if (plan) {
      revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    }
    return ok({ scenarioId: scenario.id });
  } catch (e) {
    console.error("[ortho] selectQuoteScenario failed:", e);
    return fail("No se pudo seleccionar el escenario");
  }
}
