"use server";
// Orthodontics — updateQuoteScenario. ModalOpenChoice G5 con cards editables:
// la clínica modifica enganche, monto mensual, número de meses, total y
// label/badge de cada escenario antes de presentarlo al paciente.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const paymentModeEnum = z.enum([
  "CONTADO",
  "ENGANCHE_MENSUALIDADES",
  "ENGANCHE_MSI",
]);

const inputSchema = z.object({
  scenarioId: z.string().uuid(),
  label: z.string().min(2).max(120).optional(),
  paymentMode: paymentModeEnum.optional(),
  downPayment: z.number().nonnegative().max(500_000).optional(),
  monthlyAmount: z.number().nonnegative().max(500_000).optional(),
  monthsCount: z.number().int().min(0).max(120).optional(),
  totalAmount: z.number().positive().max(500_000).optional(),
  discountPct: z.number().int().min(0).max(100).nullable().optional(),
  badge: z.string().max(40).nullable().optional(),
  includes: z.array(z.string().max(160)).max(8).optional(),
});

export async function updateQuoteScenario(
  input: unknown,
): Promise<ActionResult<{ scenarioId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  const before = await prisma.orthoQuoteScenario.findFirst({
    where: { id: data.scenarioId, clinicId: ctx.clinicId },
  });
  if (!before) return fail("Escenario no encontrado");

  // Validación: enganche < total cuando ambos están presentes.
  const newDown = data.downPayment ?? Number(before.downPayment);
  const newTotal = data.totalAmount ?? Number(before.totalAmount);
  if (newDown >= newTotal) {
    return fail("El enganche no puede ser mayor o igual al total");
  }

  const { scenarioId, ...rest } = data;
  const updateData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) updateData[key] = value;
  }

  try {
    await prisma.orthoQuoteScenario.update({
      where: { id: scenarioId },
      data: updateData,
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.QUOTE_SCENARIO_SELECTED,
      entityType: "OrthoQuoteScenario",
      entityId: scenarioId,
      before: before as unknown as Record<string, unknown>,
      after: updateData,
    });

    const plan = await prisma.orthodonticTreatmentPlan.findUnique({
      where: { id: before.treatmentPlanId },
      select: { patientId: true },
    });
    try {
      if (plan) {
        revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
        revalidatePath(`/dashboard/patients/${plan.patientId}`);
      }
    } catch (e) {
      console.error("[ortho] updateQuoteScenario · revalidate:", e);
    }
    return ok({ scenarioId });
  } catch (e) {
    console.error("[ortho] updateQuoteScenario failed:", e);
    return fail(
      e instanceof Error
        ? `No se pudo actualizar el escenario: ${e.message}`
        : "No se pudo actualizar el escenario",
    );
  }
}
