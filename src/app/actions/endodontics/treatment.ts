"use server";
// Endodontics — server actions del ciclo de vida del tratamiento
// (start / updateStep / upsertRootCanal / recordMed / completeTreatment).
// Spec §5.4, §5.5, §5.6, §5.7, §5.8

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  startTreatmentSchema,
  treatmentStep1Schema,
  treatmentStep2Schema,
  treatmentStep3Schema,
  treatmentStep4Schema,
  upsertRootCanalSchema,
  recordIntracanalMedSchema,
  completeTreatmentSchema,
  type StartTreatmentInput,
  type TreatmentStep1Input,
  type TreatmentStep2Input,
  type TreatmentStep3Input,
  type TreatmentStep4Input,
  type UpsertRootCanalInput,
  type RecordIntracanalMedInput,
} from "@/lib/validation/endodontics";
import {
  ENDO_AUDIT_ACTIONS,
  auditEndo,
  fail,
  getEndoActionContext,
  isFailure,
  loadPatientForEndo,
  ok,
  type ActionResult,
} from "./_helpers";

// ─────────────────────────────────────────────────────────────────────
// startTreatment
// ─────────────────────────────────────────────────────────────────────

export async function startTreatment(
  input: StartTreatmentInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = startTreatmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const patientRes = await loadPatientForEndo({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patientRes)) return patientRes;

  // Bloquea duplicado activo en el mismo diente. Spec §5.4.
  const existing = await prisma.endodonticTreatment.findFirst({
    where: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      toothFdi: parsed.data.toothFdi,
      outcomeStatus: "EN_CURSO",
      deletedAt: null,
    },
    select: { id: true },
  });
  if (existing) {
    return fail(
      `Ya existe un tratamiento activo en el diente ${parsed.data.toothFdi}.`,
      existing.id,
    );
  }

  try {
    const created = await prisma.endodonticTreatment.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        doctorId: ctx.userId,
        toothFdi: parsed.data.toothFdi,
        treatmentType: parsed.data.treatmentType,
        diagnosisId: parsed.data.diagnosisId ?? null,
        isMultiSession: parsed.data.isMultiSession ?? false,
        currentStep: 1,
        sessionsCount: 1,
        outcomeStatus: "EN_CURSO",
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.TREATMENT_STARTED,
      entityType: "endo-treatment",
      entityId: created.id,
      after: {
        toothFdi: parsed.data.toothFdi,
        treatmentType: parsed.data.treatmentType,
        isMultiSession: parsed.data.isMultiSession ?? false,
      },
    });
    revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${parsed.data.patientId}`);
    return ok(created);
  } catch (e) {
    console.error("[startTreatment]", e);
    return fail("Error al iniciar tratamiento");
  }
}

// ─────────────────────────────────────────────────────────────────────
// updateTreatmentStep — un dispatcher para los 4 pasos del wizard
// ─────────────────────────────────────────────────────────────────────

type StepInputMap = {
  1: TreatmentStep1Input;
  2: TreatmentStep2Input;
  3: TreatmentStep3Input;
  4: TreatmentStep4Input;
};

export async function updateTreatmentStep<S extends 1 | 2 | 3 | 4>(
  step: S,
  input: StepInputMap[S],
): Promise<ActionResult<{ id: string; advancedTo: number }>> {
  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  // Validación por paso
  const parsedRes = (() => {
    if (step === 1) return treatmentStep1Schema.safeParse(input);
    if (step === 2) return treatmentStep2Schema.safeParse(input);
    if (step === 3) return treatmentStep3Schema.safeParse(input);
    return treatmentStep4Schema.safeParse(input);
  })();
  if (!parsedRes.success) return fail(parsedRes.error.errors[0]?.message ?? "Datos inválidos");
  const parsed = parsedRes.data as TreatmentStep1Input & TreatmentStep2Input & TreatmentStep3Input & TreatmentStep4Input;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: parsed.treatmentId },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      currentStep: true,
      outcomeStatus: true,
    },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");
  if (tx.outcomeStatus !== "EN_CURSO") return fail("El tratamiento ya está cerrado");

  const data: Prisma.EndodonticTreatmentUpdateInput = {};
  if (step === 1) {
    data.rubberDamPlaced = parsed.rubberDamPlaced;
    data.accessType = parsed.accessType;
  } else if (step === 2) {
    data.instrumentationSystem = parsed.instrumentationSystem;
    data.technique = parsed.technique;
    data.motorBrand = parsed.motorBrand ?? null;
    data.torqueSettings = parsed.torqueSettings ?? null;
    data.rpmSetting = parsed.rpmSetting ?? null;
  } else if (step === 3) {
    data.irrigants = parsed.irrigants as unknown as Prisma.InputJsonValue;
    data.irrigationActivation = parsed.irrigationActivation;
    data.totalIrrigationMinutes = parsed.totalIrrigationMinutes ?? null;
  } else {
    data.obturationTechnique = parsed.obturationTechnique;
    data.sealer = parsed.sealer;
    data.masterConePresetIso = parsed.masterConePresetIso ?? null;
    data.postOpRestorationPlan = parsed.postOpRestorationPlan;
    data.requiresPost = parsed.requiresPost;
    data.postMaterial = parsed.postMaterial ?? null;
    data.restorationUrgencyDays = parsed.restorationUrgencyDays;
    data.restorationDoctorId = parsed.restorationDoctorId ?? null;
  }

  const advancedTo = Math.max(tx.currentStep, step);
  data.currentStep = advancedTo;

  try {
    const updated = await prisma.endodonticTreatment.update({
      where: { id: tx.id },
      data,
      select: { id: true },
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.TREATMENT_STEP_UPDATED,
      entityType: "endo-treatment",
      entityId: updated.id,
      after: { step, advancedTo },
    });
    revalidatePath(`/dashboard/patients/${tx.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${tx.patientId}`);
    return ok({ id: updated.id, advancedTo });
  } catch (e) {
    console.error("[updateTreatmentStep]", e);
    return fail("Error al actualizar paso del tratamiento");
  }
}

// ─────────────────────────────────────────────────────────────────────
// upsertRootCanal
// ─────────────────────────────────────────────────────────────────────

export async function upsertRootCanal(
  input: UpsertRootCanalInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = upsertRootCanalSchema.safeParse(input);
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
    const data = {
      treatmentId: tx.id,
      canonicalName: parsed.data.canonicalName,
      customLabel: parsed.data.customLabel ?? null,
      workingLengthMm: new Prisma.Decimal(parsed.data.workingLengthMm),
      coronalReferencePoint: parsed.data.coronalReferencePoint,
      masterApicalFileIso: parsed.data.masterApicalFileIso,
      masterApicalFileTaper: new Prisma.Decimal(parsed.data.masterApicalFileTaper),
      apexLocatorReadingMm: parsed.data.apexLocatorReadingMm
        ? new Prisma.Decimal(parsed.data.apexLocatorReadingMm)
        : null,
      radiographicLengthMm: parsed.data.radiographicLengthMm
        ? new Prisma.Decimal(parsed.data.radiographicLengthMm)
        : null,
      apexLocatorBrand: parsed.data.apexLocatorBrand ?? null,
      conductometryFileId: parsed.data.conductometryFileId ?? null,
      obturationQuality: parsed.data.obturationQuality ?? null,
      notes: parsed.data.notes ?? null,
    };

    const upserted = parsed.data.id
      ? await prisma.rootCanal.update({
          where: { id: parsed.data.id },
          data,
          select: { id: true },
        })
      : await prisma.rootCanal.create({
          data: { ...data, createdByUserId: ctx.userId },
          select: { id: true },
        });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.ROOT_CANAL_UPSERT,
      entityType: "endo-rootcanal",
      entityId: upserted.id,
      after: {
        canonicalName: parsed.data.canonicalName,
        workingLengthMm: parsed.data.workingLengthMm,
        obturationQuality: parsed.data.obturationQuality,
      },
    });
    revalidatePath(`/dashboard/patients/${tx.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${tx.patientId}`);
    return ok(upserted);
  } catch (e) {
    console.error("[upsertRootCanal]", e);
    return fail("Error al guardar conducto");
  }
}

// ─────────────────────────────────────────────────────────────────────
// recordIntracanalMedication
// ─────────────────────────────────────────────────────────────────────

export async function recordIntracanalMedication(
  input: RecordIntracanalMedInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = recordIntracanalMedSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: parsed.data.treatmentId },
    select: { id: true, clinicId: true, patientId: true, isMultiSession: true },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");
  if (!tx.isMultiSession) {
    return fail("Solo TCs multi-sesión registran medicación intracanal");
  }

  try {
    const created = await prisma.intracanalMedication.create({
      data: {
        treatmentId: tx.id,
        substance: parsed.data.substance,
        placedAt: new Date(parsed.data.placedAt),
        expectedRemovalAt: parsed.data.expectedRemovalAt ? new Date(parsed.data.expectedRemovalAt) : null,
        notes: parsed.data.notes ?? null,
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.INTRACANAL_MED_RECORDED,
      entityType: "endo-medication",
      entityId: created.id,
      after: { substance: parsed.data.substance, placedAt: parsed.data.placedAt },
    });
    revalidatePath(`/dashboard/patients/${tx.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${tx.patientId}`);
    return ok(created);
  } catch (e) {
    console.error("[recordIntracanalMedication]", e);
    return fail("Error al registrar medicación intracanal");
  }
}

// ─────────────────────────────────────────────────────────────────────
// completeTreatment — cierra el TC, programa los 3 controles y encola
// recordatorios WhatsApp. Spec §5.8.
// ─────────────────────────────────────────────────────────────────────

export async function completeTreatment(
  input: { treatmentId: string },
): Promise<ActionResult<{ id: string; followUpsCreated: number }>> {
  const parsed = completeTreatmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: parsed.data.treatmentId },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      toothFdi: true,
      outcomeStatus: true,
      postOpRestorationPlan: true,
      restorationUrgencyDays: true,
      isMultiSession: true,
      rootCanals: { select: { id: true, obturationQuality: true } },
      patient: { select: { phone: true } },
    },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");
  if (tx.outcomeStatus === "COMPLETADO") return fail("El tratamiento ya está completado");

  // Validaciones spec §5.8: todos los conductos con calidad + plan de restauración.
  if (tx.rootCanals.length === 0) return fail("Sin conductos registrados");
  const missingQuality = tx.rootCanals.find((r) => r.obturationQuality === null);
  if (missingQuality) return fail("Hay conductos sin calidad de obturación registrada");
  if (!tx.postOpRestorationPlan) return fail("Falta plan de restauración pos-TC en el paso 4");

  const now = new Date();

  try {
    const result = await prisma.$transaction(async (db) => {
      await db.endodonticTreatment.update({
        where: { id: tx.id },
        data: {
          completedAt: now,
          outcomeStatus: "COMPLETADO",
        },
      });

      const milestones: Array<{ key: "CONTROL_6M" | "CONTROL_12M" | "CONTROL_24M"; months: number }> = [
        { key: "CONTROL_6M", months: 6 },
        { key: "CONTROL_12M", months: 12 },
        { key: "CONTROL_24M", months: 24 },
      ];
      for (const m of milestones) {
        const scheduledAt = new Date(now);
        scheduledAt.setMonth(scheduledAt.getMonth() + m.months);
        await db.endodonticFollowUp.create({
          data: {
            treatmentId: tx.id,
            milestone: m.key,
            scheduledAt,
            createdByUserId: ctx.userId,
          },
        });
      }

      // Encolar recordatorios WhatsApp. type='ENDO' marca al job runner.
      // patientPhone se resuelve en el worker desde la tabla Patient.
      const reminders: Array<{ scheduledFor: Date; message: string }> = [
        { scheduledFor: now, message: "ENDO_POST_TC_IMMEDIATE" },
      ];
      const restorationDays = tx.restorationUrgencyDays ?? 30;
      const r7 = new Date(now); r7.setDate(r7.getDate() + 7);
      const r21 = new Date(now); r21.setDate(r21.getDate() + 21);
      reminders.push({ scheduledFor: r7, message: "ENDO_RESTORATION_7D" });
      if (restorationDays >= 21) {
        reminders.push({ scheduledFor: r21, message: "ENDO_RESTORATION_21D" });
      }
      for (const m of milestones) {
        const sched = new Date(now);
        sched.setMonth(sched.getMonth() + m.months);
        sched.setDate(sched.getDate() - 14); // 2 semanas antes del control
        reminders.push({
          scheduledFor: sched,
          message:
            m.key === "CONTROL_6M" ? "ENDO_FOLLOWUP_6M"
            : m.key === "CONTROL_12M" ? "ENDO_FOLLOWUP_12M"
            : "ENDO_FOLLOWUP_24M",
        });
      }
      // Storing patientPhone + payload (toothFdi) permite que el queue
      // worker A2 hidrate la plantilla sin re-fetchear el tratamiento.
      // Si el paciente no tiene teléfono, igualmente registramos el row
      // — el worker lo marcará como FAILED y se ve en analytics.
      for (const r of reminders) {
        await db.whatsAppReminder.create({
          data: {
            clinicId: ctx.clinicId,
            type: "ENDO",
            status: "PENDING",
            scheduledFor: r.scheduledFor,
            message: r.message,
            patientPhone: tx.patient?.phone ?? null,
            payload: { toothFdi: tx.toothFdi },
          },
        });
      }

      return { followUpsCreated: milestones.length };
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.TREATMENT_COMPLETED,
      entityType: "endo-treatment",
      entityId: tx.id,
      after: { completedAt: now.toISOString(), followUpsCreated: result.followUpsCreated },
    });
    revalidatePath(`/dashboard/patients/${tx.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${tx.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics`);
    return ok({ id: tx.id, followUpsCreated: result.followUpsCreated });
  } catch (e) {
    console.error("[completeTreatment]", e);
    return fail("Error al completar tratamiento");
  }
}
