"use server";
// Endodontics — server actions para EndodonticFollowUp. Spec §5.9

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  scheduleFollowUpSchema,
  completeFollowUpSchema,
  type CompleteFollowUpInput,
} from "@/lib/validation/endodontics";
import {
  ENDO_AUDIT_ACTIONS,
  auditEndo,
  fail,
  getEndoActionContext,
  isFailure,
  ok,
  type ActionResult,
} from "./_helpers";

export async function scheduleFollowUp(
  input: { treatmentId: string; milestone: "CONTROL_6M" | "CONTROL_12M" | "CONTROL_24M" | "CONTROL_EXTRA"; scheduledAt: string },
): Promise<ActionResult<{ id: string }>> {
  const parsed = scheduleFollowUpSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: parsed.data.treatmentId },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");

  try {
    const created = await prisma.endodonticFollowUp.create({
      data: {
        treatmentId: tx.id,
        milestone: parsed.data.milestone,
        scheduledAt: new Date(parsed.data.scheduledAt),
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });
    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.FOLLOWUP_SCHEDULED,
      entityType: "endo-followup",
      entityId: created.id,
      after: { milestone: parsed.data.milestone, scheduledAt: parsed.data.scheduledAt },
    });
    revalidatePath(`/dashboard/patients/${tx.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${tx.patientId}`);
    return ok(created);
  } catch (e) {
    console.error("[scheduleFollowUp]", e);
    return fail("Error al programar control");
  }
}

export async function completeFollowUp(
  input: CompleteFollowUpInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = completeFollowUpSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const followUp = await prisma.endodonticFollowUp.findUnique({
    where: { id: parsed.data.followUpId },
    select: {
      id: true,
      milestone: true,
      treatmentId: true,
      treatment: { select: { id: true, clinicId: true, patientId: true } },
    },
  });
  if (!followUp || followUp.treatment.clinicId !== ctx.clinicId) {
    return fail("Control no encontrado");
  }

  try {
    const updated = await prisma.endodonticFollowUp.update({
      where: { id: followUp.id },
      data: {
        performedAt: new Date(parsed.data.performedAt),
        paiScore: parsed.data.paiScore,
        symptomsPresent: parsed.data.symptomsPresent,
        conclusion: parsed.data.conclusion,
        recommendedAction: parsed.data.recommendedAction ?? null,
        controlFileId: parsed.data.controlFileId ?? null,
      },
      select: { id: true },
    });

    // Si fracaso, marca el tratamiento como FALLIDO. Spec §5.9.
    if (parsed.data.conclusion === "FRACASO") {
      await prisma.endodonticTreatment.update({
        where: { id: followUp.treatment.id },
        data: { outcomeStatus: "FALLIDO" },
      });
    }

    // Si en CONTROL_24M la conclusión es EN_CURACION, programa CONTROL_EXTRA.
    if (
      parsed.data.conclusion === "EN_CURACION" &&
      followUp.milestone === "CONTROL_24M"
    ) {
      const extra = new Date(parsed.data.performedAt);
      extra.setMonth(extra.getMonth() + 6);
      await prisma.endodonticFollowUp.create({
        data: {
          treatmentId: followUp.treatment.id,
          milestone: "CONTROL_EXTRA",
          scheduledAt: extra,
          createdByUserId: ctx.userId,
        },
      });
    }

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.FOLLOWUP_COMPLETED,
      entityType: "endo-followup",
      entityId: updated.id,
      after: {
        paiScore: parsed.data.paiScore,
        conclusion: parsed.data.conclusion,
        symptomsPresent: parsed.data.symptomsPresent,
      },
    });
    revalidatePath(`/dashboard/patients/${followUp.treatment.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${followUp.treatment.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics`);
    return ok(updated);
  } catch (e) {
    console.error("[completeFollowUp]", e);
    return fail("Error al cerrar control");
  }
}
