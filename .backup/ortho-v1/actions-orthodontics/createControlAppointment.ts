"use server";
// Orthodontics — action 11/15: createControlAppointment con snapshot del payment status. SPEC §5.2.
// + encolado WhatsApp F9.5 (APPOINTMENT_REMINDER_24H, MISSED_APPOINTMENT, MONTHLY_PROGRESS).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createControlAppointmentSchema } from "@/lib/validation/orthodontics";
import {
  enqueueOrthoWhatsAppBatch,
  type EnqueueOrthoWhatsAppInput,
} from "@/lib/orthodontics/whatsapp-queue";
import { linkSessionToPlan } from "@/lib/clinical-shared/treatment-link/link";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const MILESTONE_MONTHS = new Set([6, 12, 18]);

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
    include: {
      paymentPlan: { select: { status: true } },
      patient: { select: { phone: true } },
    },
  });
  if (!plan) return fail("Plan no encontrado");

  try {
    const created = await prisma.$transaction(async (tx) => {
      const appt = await tx.orthodonticControlAppointment.create({
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

      if (parsed.data.treatmentSessionId && parsed.data.attendance === "ATTENDED") {
        await linkSessionToPlan(
          {
            clinicId: ctx.clinicId,
            module: "orthodontics",
            moduleEntityType: "ortho-control",
            moduleSessionId: appt.id,
            treatmentSessionId: parsed.data.treatmentSessionId,
            linkedBy: ctx.userId,
            notes: `Control mes ${appt.monthInTreatment}`,
          },
          tx,
        );
      }

      return appt;
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

    // ─── WhatsApp queue (F9.5) ──────────────────────────────────────
    const phone = plan.patient.phone;
    const scheduledAt = new Date(parsed.data.scheduledAt);
    const reminders: EnqueueOrthoWhatsAppInput[] = [];

    if (parsed.data.attendance === "NO_SHOW") {
      // Recordatorio inmediato post-falta.
      reminders.push({
        clinicId: ctx.clinicId,
        templateKey: "MISSED_APPOINTMENT",
        scheduledFor: new Date(),
        patientPhone: phone,
      });
    } else if (parsed.data.attendance === "ATTENDED") {
      // Si la cita aún está en el futuro y NO se marcó como completada,
      // encolar el reminder de 24h. (Esto cubre el caso de pre-agendamiento.)
      const isFuture = scheduledAt.getTime() - Date.now() > 24 * 60 * 60 * 1000;
      if (isFuture && !parsed.data.performedAt) {
        const remindAt = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
        reminders.push({
          clinicId: ctx.clinicId,
          templateKey: "APPOINTMENT_REMINDER_24H",
          scheduledFor: remindAt,
          patientPhone: phone,
        });
      }

      // MONTHLY_PROGRESS milestones (mes 6, 12, 18) si la cita fue
      // efectivamente completada.
      if (
        parsed.data.performedAt &&
        MILESTONE_MONTHS.has(parsed.data.monthInTreatment)
      ) {
        reminders.push({
          clinicId: ctx.clinicId,
          templateKey: "MONTHLY_PROGRESS",
          scheduledFor: new Date(),
          patientPhone: phone,
        });
      }
    }

    // Si la cita programa una próxima cita, encolar 24h reminder para esa.
    if (parsed.data.nextAppointmentAt) {
      const nextAt = new Date(parsed.data.nextAppointmentAt);
      const remindAt = new Date(nextAt.getTime() - 24 * 60 * 60 * 1000);
      if (remindAt.getTime() > Date.now()) {
        reminders.push({
          clinicId: ctx.clinicId,
          templateKey: "APPOINTMENT_REMINDER_24H",
          scheduledFor: remindAt,
          patientPhone: phone,
        });
      }
    }

    if (reminders.length > 0) {
      await enqueueOrthoWhatsAppBatch(prisma, reminders).catch((e) => {
        console.error("[ortho] WA enqueue failed (no bloquea):", e);
      });
    }

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: created.id });
  } catch (e) {
    console.error("[ortho] createControlAppointment failed:", e);
    return fail("No se pudo registrar el control");
  }
}
