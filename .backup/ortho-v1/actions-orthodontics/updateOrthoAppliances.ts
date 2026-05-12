"use server";
// Orthodontics — updateOrthoAppliances. Sección C "Cambiar aparatología":
// permite a la clínica modificar prescriptionSlot, bondingType, technique,
// prescriptionNotes del plan ortodóntico activo. Wrapper sobre
// updateTreatmentPlan acotado a campos de aparatología.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const slotEnum = z.enum([
  "MBT_018",
  "MBT_022",
  "ROTH_018",
  "ROTH_022",
  "DAMON_Q2",
  "DAMON_ULTIMA",
  "SPARK",
  "INVISALIGN",
]);
const bondingEnum = z.enum(["DIRECTO", "INDIRECTO"]);
const techniqueEnum = z.enum([
  "METAL_BRACKETS",
  "CERAMIC_BRACKETS",
  "SELF_LIGATING_METAL",
  "SELF_LIGATING_CERAMIC",
  "LINGUAL_BRACKETS",
  "CLEAR_ALIGNERS",
  "HYBRID",
]);

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  prescriptionSlot: slotEnum.optional(),
  bondingType: bondingEnum.optional(),
  technique: techniqueEnum.optional(),
  prescriptionNotes: z.string().max(1000).nullable().optional(),
});

export async function updateOrthoAppliances(
  input: unknown,
): Promise<ActionResult<{ planId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  const before = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true,
      patientId: true,
      prescriptionSlot: true,
      bondingType: true,
      technique: true,
      prescriptionNotes: true,
    },
  });
  if (!before) return fail("Plan no encontrado");

  const { treatmentPlanId, ...rest } = data;
  const updateData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) updateData[k] = v;
  }

  try {
    await prisma.orthodonticTreatmentPlan.update({
      where: { id: treatmentPlanId },
      data: updateData,
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_UPDATED,
      entityType: "OrthodonticTreatmentPlan",
      entityId: treatmentPlanId,
      before: {
        prescriptionSlot: before.prescriptionSlot,
        bondingType: before.bondingType,
        technique: before.technique,
        prescriptionNotes: before.prescriptionNotes,
      },
      after: updateData,
    });

    try {
      revalidatePath(`/dashboard/specialties/orthodontics/${before.patientId}`);
      revalidatePath(`/dashboard/patients/${before.patientId}`);
    } catch (e) {
      console.error("[ortho] updateOrthoAppliances · revalidate:", e);
    }
    return ok({ planId: treatmentPlanId });
  } catch (e) {
    console.error("[ortho] updateOrthoAppliances failed:", e);
    return fail(
      e instanceof Error
        ? `No se pudo actualizar la aparatología: ${e.message}`
        : "No se pudo actualizar la aparatología",
    );
  }
}
