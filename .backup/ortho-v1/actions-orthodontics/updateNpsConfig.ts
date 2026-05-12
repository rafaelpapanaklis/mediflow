"use server";
// Orthodontics — updateNpsConfig. Sección H "Configurar NPS": ajusta los
// schedules NPS post-debond (windows en días para POST_DEBOND_3D / 6M / 12M)
// y mensaje custom de WhatsApp template.
//
// La ejecución del envío real corre por Twilio (cron job lee
// orthoNpsSchedule pendientes). Aquí solo se persiste la configuración.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  /** Días desde debond para enviar NPS +3D (default 3). */
  windowEarlyDays: z.number().int().min(1).max(14).default(3),
  /** Días desde debond para NPS +6M (default 180). */
  windowMidDays: z.number().int().min(60).max(240).default(180),
  /** Días desde debond para NPS +12M (default 360). */
  windowLateDays: z.number().int().min(180).max(540).default(360),
  /** Mensaje custom WhatsApp (opcional, persistido para que cron lo use). */
  customMessage: z.string().max(500).nullable().optional(),
  /** ¿Activar Google review trigger automático cuando NPS ≥ 9? */
  triggerGoogleReview: z.boolean().default(true),
});

export async function updateNpsConfig(
  input: unknown,
): Promise<ActionResult<{ updatedCount: number }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: {
      id: data.treatmentPlanId,
      clinicId: ctx.clinicId,
      deletedAt: null,
    },
    select: { id: true, clinicId: true, patientId: true, status: true },
  });
  if (!plan) return fail("Plan no encontrado");

  // Si ya existen NPS schedules previos (creados al avanzar a Retention),
  // los re-agendamos. Si no, dejamos la config en audit para que se aplique
  // cuando el debond ocurra.
  const debondReference = await prisma.orthoRetentionRegimen.findUnique({
    where: { treatmentPlanId: plan.id },
    select: { debondedAt: true },
  });
  const debondAt = debondReference?.debondedAt ?? null;

  const existing = await prisma.orthoNpsSchedule.findMany({
    where: { treatmentPlanId: plan.id, clinicId: ctx.clinicId },
  });

  let updatedCount = 0;
  if (existing.length > 0 && debondAt) {
    // Reescribir scheduledAt con base en los nuevos windows.
    const windows: Array<{
      type: "POST_DEBOND_3D" | "POST_DEBOND_6M" | "POST_DEBOND_12M";
      days: number;
    }> = [
      { type: "POST_DEBOND_3D", days: data.windowEarlyDays },
      { type: "POST_DEBOND_6M", days: data.windowMidDays },
      { type: "POST_DEBOND_12M", days: data.windowLateDays },
    ];
    for (const w of windows) {
      const target = new Date(debondAt);
      target.setDate(target.getDate() + w.days);
      await prisma.orthoNpsSchedule.upsert({
        where: {
          treatmentPlanId_npsType: {
            treatmentPlanId: plan.id,
            npsType: w.type,
          },
        },
        create: {
          treatmentPlanId: plan.id,
          patientId: plan.patientId,
          clinicId: ctx.clinicId,
          npsType: w.type,
          scheduledAt: target,
          status: "SCHEDULED",
        },
        update: { scheduledAt: target, status: "SCHEDULED" },
      });
      updatedCount++;
    }
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.NPS_SCHEDULED,
    entityType: "OrthodonticTreatmentPlan",
    entityId: plan.id,
    after: {
      windowEarlyDays: data.windowEarlyDays,
      windowMidDays: data.windowMidDays,
      windowLateDays: data.windowLateDays,
      customMessage: data.customMessage ?? null,
      triggerGoogleReview: data.triggerGoogleReview,
      updatedSchedulesCount: updatedCount,
    },
  });

  try {
    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
  } catch (e) {
    console.error("[ortho] updateNpsConfig · revalidate:", e);
  }

  return ok({ updatedCount });
}
