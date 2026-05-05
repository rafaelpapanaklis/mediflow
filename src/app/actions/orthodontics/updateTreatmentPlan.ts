"use server";
// Orthodontics — action 4/15: updateTreatmentPlan. SPEC §5.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { updateTreatmentPlanSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function updateTreatmentPlan(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = updateTreatmentPlanSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const before = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
  });
  if (!before) return fail("Plan no encontrado");

  // Validación específica: si status pasa a DROPPED_OUT, exige droppedOutReason.
  if (parsed.data.status === "DROPPED_OUT") {
    if (!parsed.data.droppedOutReason || parsed.data.droppedOutReason.length < 20) {
      return fail("DROPPED_OUT requiere droppedOutReason ≥20 caracteres");
    }
  }

  const { treatmentPlanId, diagnosisId, patientId, ...rest } = parsed.data;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) data[key] = value;
  }
  if (parsed.data.status === "DROPPED_OUT" && !data.droppedOutAt) {
    data.droppedOutAt = new Date();
  }
  if (parsed.data.status && parsed.data.status !== before.status) {
    data.statusUpdatedAt = new Date();
  }

  try {
    const updated = await prisma.orthodonticTreatmentPlan.update({
      where: { id: treatmentPlanId },
      data,
    });

    const action =
      parsed.data.status && parsed.data.status !== before.status
        ? ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_STATUS_CHANGED
        : ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_UPDATED;

    await auditOrtho({
      ctx,
      action,
      entityType: "OrthodonticTreatmentPlan",
      entityId: updated.id,
      before: { status: before.status, totalCostMxn: before.totalCostMxn.toString() },
      after: { status: updated.status, totalCostMxn: updated.totalCostMxn.toString() },
    });

    revalidatePath(`/dashboard/patients/${updated.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${updated.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);
    void diagnosisId;
    void patientId;
    return ok({ id: updated.id });
  } catch (e) {
    console.error("[ortho] updateTreatmentPlan failed:", e);
    return fail("No se pudo actualizar el plan");
  }
}
