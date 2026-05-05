"use server";
// Orthodontics — action 11/15: createControlAppointment con snapshot del payment status. SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createControlAppointmentSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createControlAppointment(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createControlAppointmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: {
      id: parsed.data.treatmentPlanId,
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      deletedAt: null,
    },
    include: { paymentPlan: { select: { status: true } } },
  });
  if (!plan) return fail("Plan no encontrado");

  try {
    const created = await prisma.orthodonticControlAppointment.create({
      data: {
        treatmentPlanId: parsed.data.treatmentPlanId,
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        scheduledAt: new Date(parsed.data.scheduledAt),
        performedAt: parsed.data.performedAt ? new Date(parsed.data.performedAt) : null,
        monthInTreatment: parsed.data.monthInTreatment,
        attendance: parsed.data.attendance,
        attendedById: parsed.data.attendance === "ATTENDED" ? ctx.userId : null,
        hygieneScore: parsed.data.hygieneScore ?? null,
        bracketsLoose: parsed.data.bracketsLoose ?? null,
        bracketsBroken: parsed.data.bracketsBroken ?? null,
        appliancesIntact: parsed.data.appliancesIntact ?? null,
        patientReportsPain: parsed.data.patientReportsPain,
        patientPainNotes: parsed.data.patientPainNotes ?? null,
        adjustments: parsed.data.adjustments,
        adjustmentNotes: parsed.data.adjustmentNotes ?? null,
        photoSetId: parsed.data.photoSetId ?? null,
        nextAppointmentAt: parsed.data.nextAppointmentAt
          ? new Date(parsed.data.nextAppointmentAt)
          : null,
        nextAppointmentNotes: parsed.data.nextAppointmentNotes ?? null,
        paymentStatusSnapshot: plan.paymentPlan?.status ?? null,
      },
      select: { id: true, monthInTreatment: true, attendance: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.CONTROL_CREATED,
      entityType: "OrthodonticControlAppointment",
      entityId: created.id,
      after: {
        month: created.monthInTreatment,
        attendance: created.attendance,
        adjustments: parsed.data.adjustments,
      },
    });

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: created.id });
  } catch (e) {
    console.error("[ortho] createControlAppointment failed:", e);
    return fail("No se pudo registrar el control");
  }
}
