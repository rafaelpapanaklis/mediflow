// Periodontics — server actions de mantenimiento periodontal. SPEC §5.2.
//
// Convención: el "mantenimiento" como evento clínico se modela como un
// `PeriodontalRecord` con `recordType=MANTENIMIENTO`. Acá sólo agendamos
// el próximo (actualizando el plan) y marcamos completados los registros
// existentes.

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  scheduleMaintenanceSchema,
  completeMaintenanceSchema,
} from "@/lib/periodontics/schemas";
import {
  PERIO_AUDIT_ACTIONS,
  auditPerio,
  fail,
  getPerioActionContext,
  isFailure,
  loadPatientForPerio,
  ok,
  type ActionResult,
} from "./_helpers";

/**
 * Agenda el próximo mantenimiento actualizando `plan.nextEvaluationAt`.
 * Si el paciente no tiene plan, crea audit log con la intención sin tocar
 * el plan (el cliente debe pedir crear plan primero).
 *
 * `recallMonthsUsed` queda registrado en el audit log para análisis posteriores.
 */
export async function scheduleMaintenance(
  input: unknown,
): Promise<ActionResult<{ planId: string | null; nextEvaluationAt: Date }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = scheduleMaintenanceSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  const scheduledAt = new Date(parsed.data.scheduledAt);
  const plan = await prisma.periodontalTreatmentPlan.findFirst({
    where: { patientId: parsed.data.patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });

  try {
    if (plan) {
      await prisma.periodontalTreatmentPlan.update({
        where: { id: plan.id },
        data: { nextEvaluationAt: scheduledAt },
      });
    }

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.MAINTENANCE_SCHEDULED,
      entityType: "PeriodontalTreatmentPlan",
      entityId: plan?.id ?? parsed.data.patientId,
      after: {
        scheduledAt: scheduledAt.toISOString(),
        recallMonthsUsed: parsed.data.recallMonthsUsed,
      },
      meta: { type: "PERIO", patientId: parsed.data.patientId },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ planId: plan?.id ?? null, nextEvaluationAt: scheduledAt });
  } catch (e) {
    console.error("[perio maintenance] schedule failed:", e);
    return fail("No se pudo agendar el mantenimiento");
  }
}

/**
 * Marca como completado un PeriodontalRecord con recordType=MANTENIMIENTO.
 * No cambia el shape del record — solo audita la finalización.
 */
export async function completeMaintenance(
  input: unknown,
): Promise<ActionResult<{ recordId: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = completeMaintenanceSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const record = await prisma.periodontalRecord.findFirst({
    where: { id: parsed.data.recordId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, recordType: true },
  });
  if (!record) return fail("Registro de mantenimiento no encontrado");
  if (record.recordType !== "MANTENIMIENTO") {
    return fail("El registro no es de tipo MANTENIMIENTO");
  }

  try {
    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.MAINTENANCE_COMPLETED,
      entityType: "PeriodontalRecord",
      entityId: record.id,
      after: { completedAt: new Date().toISOString() },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${record.patientId}`);
    return ok({ recordId: record.id });
  } catch (e) {
    console.error("[perio maintenance] complete failed:", e);
    return fail("No se pudo completar el mantenimiento");
  }
}
