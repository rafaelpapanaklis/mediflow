"use server";
// Implants — programar ClinicalReminder por implante. Idempotente:
// si ya existe un reminder activo para (patientId, module=implants,
// reminderType) en una ventana de ±2 días alrededor del dueDate calculado,
// no duplica.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { planImplantReminderRules } from "@/lib/clinical-shared/reminder-rules";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const scheduleSchema = z.object({
  implantId: z.string().min(1),
});

export type ScheduleImplantRemindersInput = z.infer<typeof scheduleSchema>;

export interface ScheduleImplantRemindersResult {
  scheduled: number;
  skipped: number;
  reminders: Array<{ id: string; reminderType: string; dueDate: Date }>;
}

const NEAR_WINDOW_DAYS = 2;

export async function scheduleImplantReminders(
  input: ScheduleImplantRemindersInput,
): Promise<ActionResult<ScheduleImplantRemindersResult>> {
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }
  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const baseRes = await loadImplantForCtx({
    ctx,
    implantId: parsed.data.implantId,
  });
  if (isFailure(baseRes)) return baseRes;

  // Carga las fechas de fases para calcular due dates
  const implant = await prisma.implant.findUnique({
    where: { id: parsed.data.implantId },
    select: {
      patientId: true,
      surgicalRecord: { select: { performedAt: true } },
      secondStage: { select: { performedAt: true } },
      prostheticPhase: { select: { prosthesisDeliveredAt: true } },
    },
  });
  if (!implant) return fail("Implante no encontrado");

  const plan = planImplantReminderRules({
    surgeryDate: implant.surgicalRecord?.performedAt ?? null,
    secondStageDate: implant.secondStage?.performedAt ?? null,
    prosthesisDeliveredAt:
      implant.prostheticPhase?.prosthesisDeliveredAt ?? null,
  });

  if (plan.length === 0) {
    return ok({ scheduled: 0, skipped: 0, reminders: [] });
  }

  let scheduled = 0;
  let skipped = 0;
  const out: ScheduleImplantRemindersResult["reminders"] = [];

  for (const { rule, dueDate } of plan) {
    const lo = new Date(dueDate.getTime() - NEAR_WINDOW_DAYS * 86_400_000);
    const hi = new Date(dueDate.getTime() + NEAR_WINDOW_DAYS * 86_400_000);
    const exists = await prisma.clinicalReminder.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId: implant.patientId,
        module: "implants",
        reminderType: rule.reminderType,
        deletedAt: null,
        status: { in: ["pending", "sent"] },
        dueDate: { gte: lo, lte: hi },
      },
      select: { id: true },
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    const created = await prisma.clinicalReminder.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: implant.patientId,
        module: "implants",
        reminderType: rule.reminderType,
        dueDate,
        message: rule.defaultTitle,
        payload: {
          implantId: parsed.data.implantId,
          ruleKey: rule.ruleKey,
        },
        createdBy: ctx.userId,
      },
      select: { id: true, reminderType: true, dueDate: true },
    });
    scheduled += 1;
    out.push({
      id: created.id,
      reminderType: created.reminderType,
      dueDate: created.dueDate,
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.REMINDER_RULE_SCHEDULED,
      entityType: "ClinicalReminder",
      entityId: created.id,
      meta: {
        implantId: parsed.data.implantId,
        ruleKey: rule.ruleKey,
        dueDate: dueDate.toISOString(),
      },
    }).catch(() => {});
  }

  revalidatePath(`/dashboard/patients/${implant.patientId}`);
  return ok({ scheduled, skipped, reminders: out });
}
