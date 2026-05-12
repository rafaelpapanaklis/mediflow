"use server";
// Orthodontics — scheduleRetentionCheckups. Trigger automático al avanzar
// fase a Retención: crea OrthoRetentionRegimen (si no existe) y agenda los
// 5 checkups en 3, 6, 12, 24 y 36 meses desde el debonding.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  /** Fecha del debonding (default: ahora). */
  debondedAt: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v ? new Date(v) : new Date())),
});

const CHECKUP_MONTHS = [3, 6, 12, 24, 36] as const;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export async function scheduleRetentionCheckups(
  input: unknown,
): Promise<ActionResult<{ regimenId: string; checkupsCreated: number }>> {
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
    const debondedAt = parsed.data.debondedAt ?? new Date();
    const regimen = await prisma.orthoRetentionRegimen.upsert({
      where: { treatmentPlanId: plan.id },
      create: {
        treatmentPlanId: plan.id,
        clinicId: plan.clinicId,
        debondedAt,
        upperRetainer: "HAWLEY_SUP",
        lowerRetainer: "ESSIX_INF",
        fixedLingualPresent: true,
        fixedLingualGauge: "G_0195",
        regimenDescription: "24/7 año 1 · nocturno años 2-5",
        preSurveyEnabled: true,
      },
      update: { debondedAt },
      select: { id: true },
    });

    const created = await prisma.$transaction(
      CHECKUP_MONTHS.map((m) =>
        prisma.orthoRetainerCheckup.upsert({
          where: { regimenId_monthsFromDebond: { regimenId: regimen.id, monthsFromDebond: m } },
          create: {
            regimenId: regimen.id,
            clinicId: plan.clinicId,
            monthsFromDebond: m,
            scheduledDate: addMonths(debondedAt, m),
            status: "PROGRAMMED",
          },
          update: { scheduledDate: addMonths(debondedAt, m) },
          select: { id: true },
        }),
      ),
    );

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.RETAINER_CHECKUPS_SCHEDULED,
      entityType: "OrthoRetentionRegimen",
      entityId: regimen.id,
      after: { months: CHECKUP_MONTHS, debondedAt },
    });

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    return ok({ regimenId: regimen.id, checkupsCreated: created.length });
  } catch (e) {
    console.error("[ortho] scheduleRetentionCheckups failed:", e);
    return fail("No se pudieron agendar los controles de retención");
  }
}
