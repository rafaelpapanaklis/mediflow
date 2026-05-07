"use server";
// Orthodontics — scheduleG15Checkpoint. Sección E "Programar foto-set
// mes 12" (G15 mid-treatment trigger). Crea un OrthoPhotoSet stage CONTROL
// con capturedAt en el día programado (mes 12 desde startDate del plan).
// Sirve como recordatorio en agenda — no contiene fotos hasta que el
// doctor las suba el día de la cita.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  /** ISO date opcional. Default: startDate + 12 meses. */
  scheduledFor: z.string().datetime().optional(),
});

export async function scheduleG15Checkpoint(
  input: unknown,
): Promise<ActionResult<{ photoSetId: string; scheduledFor: string }>> {
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
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      installedAt: true,
      startDate: true,
    },
  });
  if (!plan) return fail("Plan no encontrado");

  const baseStart = plan.installedAt ?? plan.startDate ?? new Date();
  const defaultScheduled = new Date(baseStart);
  defaultScheduled.setMonth(defaultScheduled.getMonth() + 12);
  const scheduledFor = data.scheduledFor
    ? new Date(data.scheduledFor)
    : defaultScheduled;

  // Idempotente: si ya existe CONTROL en una ventana de ±30 días, lo reutiliza.
  const windowStart = new Date(scheduledFor);
  windowStart.setDate(windowStart.getDate() - 30);
  const windowEnd = new Date(scheduledFor);
  windowEnd.setDate(windowEnd.getDate() + 30);
  const existing = await prisma.orthoPhotoSet.findFirst({
    where: {
      treatmentPlanId: plan.id,
      setType: "CONTROL",
      capturedAt: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true, capturedAt: true },
  });
  if (existing) {
    return ok({
      photoSetId: existing.id,
      scheduledFor: existing.capturedAt.toISOString(),
    });
  }

  try {
    const created = await prisma.orthoPhotoSet.create({
      data: {
        treatmentPlanId: plan.id,
        patientId: plan.patientId,
        clinicId: ctx.clinicId,
        capturedById: ctx.userId,
        setType: "CONTROL",
        capturedAt: scheduledFor,
        monthInTreatment: 12,
        notes:
          "G15 mid-treatment checkpoint · 10 vistas + RX panorámica · sube al día de la cita",
      },
      select: { id: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.G15_CHECKPOINT_SCHEDULED,
      entityType: "OrthoPhotoSet",
      entityId: created.id,
      after: {
        setType: "CONTROL",
        scheduledFor: scheduledFor.toISOString(),
      },
    });

    try {
      revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
      revalidatePath(`/dashboard/patients/${plan.patientId}`);
    } catch (e) {
      console.error("[ortho] scheduleG15Checkpoint · revalidate:", e);
    }

    return ok({
      photoSetId: created.id,
      scheduledFor: scheduledFor.toISOString(),
    });
  } catch (e) {
    console.error("[ortho] scheduleG15Checkpoint failed:", e);
    return fail(
      e instanceof Error
        ? `No se pudo programar el checkpoint: ${e.message}`
        : "No se pudo programar el checkpoint",
    );
  }
}
