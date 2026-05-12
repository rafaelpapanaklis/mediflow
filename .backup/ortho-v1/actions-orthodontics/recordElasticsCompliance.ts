"use server";
// Orthodontics — el doctor registra el compliance mensual de elásticos
// reportado por el paciente. Si <70%, encola un ClinicalReminder
// motivacional para el siguiente período.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const schema = z.object({
  patientId: z.string().min(1),
  treatmentPlanId: z.string().min(1),
  /** ISO date del fin del período evaluado (eg. fin de mes). */
  evaluatedAt: z.string().datetime(),
  /** Porcentaje 0-100. */
  compliancePct: z.number().int().min(0).max(100),
  notes: z.string().max(1000).optional().nullable(),
});

const LOW_COMPLIANCE_THRESHOLD = 70;

export async function recordElasticsCompliance(
  input: unknown,
): Promise<ActionResult<{ reminderEnqueued: boolean }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: {
      id: parsed.data.treatmentPlanId,
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!plan) return fail("Plan no encontrado");

  let reminderEnqueued = false;

  if (parsed.data.compliancePct < LOW_COMPLIANCE_THRESHOLD) {
    // Encola un ClinicalReminder de tipo "other" con subtype motivacional
    // para que el cron de clinical-reminders lo encole en WhatsApp.
    const dueIn14 = new Date();
    dueIn14.setDate(dueIn14.getDate() + 14);

    await prisma.clinicalReminder.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        module: "orthodontics",
        reminderType: "other",
        dueDate: dueIn14,
        message: "Recordatorio motivacional de elásticos por baja adherencia",
        payload: {
          subtype: "ortho_aligner_change_2w",
          source: "elastics_compliance",
          evaluatedCompliancePct: parsed.data.compliancePct,
        },
        createdBy: ctx.userId,
      },
    });
    reminderEnqueued = true;
  }

  await auditOrtho({
    ctx,
    action: "ortho.elastics.compliance.recorded",
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    after: {
      evaluatedAt: parsed.data.evaluatedAt,
      compliancePct: parsed.data.compliancePct,
      reminderEnqueued,
    },
  });

  revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
  revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);

  return ok({ reminderEnqueued });
}
