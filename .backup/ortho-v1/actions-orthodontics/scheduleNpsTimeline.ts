"use server";
// Orthodontics — scheduleNpsTimeline. Trigger automático al marcar plan
// como COMPLETED (debonding final): crea las 3 entradas NPS:
//   - POST_DEBOND_3D: +3 días → puerta de entrada al Google review
//   - POST_DEBOND_6M: +6 meses → seguimiento estabilidad
//   - POST_DEBOND_12M: +12 meses → seguimiento largo plazo

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  /** Fecha de referencia (default ahora). */
  completedAt: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? new Date(v) : new Date())),
});

const NPS_OFFSETS: Array<{ type: "POST_DEBOND_3D" | "POST_DEBOND_6M" | "POST_DEBOND_12M"; days: number }> = [
  { type: "POST_DEBOND_3D", days: 3 },
  { type: "POST_DEBOND_6M", days: 30 * 6 },
  { type: "POST_DEBOND_12M", days: 30 * 12 },
];

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export async function scheduleNpsTimeline(
  input: unknown,
): Promise<ActionResult<{ scheduled: number }>> {
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
    const completedAt = parsed.data.completedAt ?? new Date();

    const ops = NPS_OFFSETS.map((off) =>
      prisma.orthoNpsSchedule.upsert({
        where: {
          treatmentPlanId_npsType: { treatmentPlanId: plan.id, npsType: off.type },
        },
        create: {
          treatmentPlanId: plan.id,
          patientId: plan.patientId,
          clinicId: plan.clinicId,
          npsType: off.type,
          scheduledAt: addDays(completedAt, off.days),
          status: "SCHEDULED",
        },
        update: { scheduledAt: addDays(completedAt, off.days) },
        select: { id: true },
      }),
    );
    const created = await prisma.$transaction(ops);

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.NPS_SCHEDULED,
      entityType: "OrthodonticTreatmentPlan",
      entityId: plan.id,
      after: {
        scheduledAt3d: addDays(completedAt, 3),
        scheduledAt6m: addDays(completedAt, 30 * 6),
        scheduledAt12m: addDays(completedAt, 30 * 12),
      },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    return ok({ scheduled: created.length });
  } catch (e) {
    console.error("[ortho] scheduleNpsTimeline failed:", e);
    return fail("No se pudo agendar la timeline NPS");
  }
}
