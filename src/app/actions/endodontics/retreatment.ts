"use server";
// Endodontics — server actions para EndodonticRetreatmentInfo y ApicalSurgery. Spec §5.10

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  createRetreatmentInfoSchema,
  createApicalSurgerySchema,
  type CreateRetreatmentInfoInput,
  type CreateApicalSurgeryInput,
} from "@/lib/validation/endodontics";
import {
  ENDO_AUDIT_ACTIONS,
  auditEndo,
  fail,
  getEndoActionContext,
  isFailure,
  ok,
  type ActionResult,
} from "./_helpers";

export async function createRetreatmentInfo(
  input: CreateRetreatmentInfoInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createRetreatmentInfoSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: parsed.data.treatmentId },
    select: { id: true, clinicId: true, patientId: true, treatmentType: true },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");
  if (tx.treatmentType !== "RETRATAMIENTO") {
    return fail("Solo aplica a tratamientos tipo RETRATAMIENTO");
  }

  try {
    const created = await prisma.endodonticRetreatmentInfo.upsert({
      where: { treatmentId: tx.id },
      create: {
        treatmentId: tx.id,
        failureReason: parsed.data.failureReason,
        originalTreatmentDate: parsed.data.originalTreatmentDate
          ? new Date(parsed.data.originalTreatmentDate)
          : null,
        fracturedInstrumentRecovered: parsed.data.fracturedInstrumentRecovered ?? false,
        difficulty: parsed.data.difficulty ?? "MEDIA",
        notes: parsed.data.notes ?? null,
        createdByUserId: ctx.userId,
      },
      update: {
        failureReason: parsed.data.failureReason,
        originalTreatmentDate: parsed.data.originalTreatmentDate
          ? new Date(parsed.data.originalTreatmentDate)
          : null,
        fracturedInstrumentRecovered: parsed.data.fracturedInstrumentRecovered ?? false,
        difficulty: parsed.data.difficulty ?? "MEDIA",
        notes: parsed.data.notes ?? null,
      },
      select: { id: true },
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.RETREATMENT_INFO_CREATED,
      entityType: "endo-retreatment",
      entityId: created.id,
      after: {
        failureReason: parsed.data.failureReason,
        difficulty: parsed.data.difficulty ?? "MEDIA",
      },
    });
    revalidatePath(`/dashboard/patients/${tx.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${tx.patientId}`);
    return ok(created);
  } catch (e) {
    console.error("[createRetreatmentInfo]", e);
    return fail("Error al guardar información de retratamiento");
  }
}

export async function createApicalSurgery(
  input: CreateApicalSurgeryInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createApicalSurgerySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const tx = await prisma.endodonticTreatment.findUnique({
    where: { id: parsed.data.treatmentId },
    select: { id: true, clinicId: true, patientId: true, treatmentType: true },
  });
  if (!tx || tx.clinicId !== ctx.clinicId) return fail("Tratamiento no encontrado");
  if (tx.treatmentType !== "APICECTOMIA") {
    return fail("Solo aplica a tratamientos tipo APICECTOMIA");
  }

  try {
    const created = await prisma.apicalSurgery.upsert({
      where: { treatmentId: tx.id },
      create: {
        treatmentId: tx.id,
        interventedRoot: parsed.data.interventedRoot,
        resectedRootLengthMm: new Prisma.Decimal(parsed.data.resectedRootLengthMm),
        retroFillingMaterial: parsed.data.retroFillingMaterial,
        flapType: parsed.data.flapType,
        sutureType: parsed.data.sutureType ?? null,
        postOpControlAt: parsed.data.postOpControlAt
          ? new Date(parsed.data.postOpControlAt)
          : null,
        intraoperativeFileId: parsed.data.intraoperativeFileId ?? null,
        notes: parsed.data.notes ?? null,
        createdByUserId: ctx.userId,
      },
      update: {
        interventedRoot: parsed.data.interventedRoot,
        resectedRootLengthMm: new Prisma.Decimal(parsed.data.resectedRootLengthMm),
        retroFillingMaterial: parsed.data.retroFillingMaterial,
        flapType: parsed.data.flapType,
        sutureType: parsed.data.sutureType ?? null,
        postOpControlAt: parsed.data.postOpControlAt
          ? new Date(parsed.data.postOpControlAt)
          : null,
        intraoperativeFileId: parsed.data.intraoperativeFileId ?? null,
        notes: parsed.data.notes ?? null,
      },
      select: { id: true },
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.APICAL_SURGERY_CREATED,
      entityType: "endo-apical",
      entityId: created.id,
      after: {
        interventedRoot: parsed.data.interventedRoot,
        flapType: parsed.data.flapType,
        retroFillingMaterial: parsed.data.retroFillingMaterial,
      },
    });
    revalidatePath(`/dashboard/patients/${tx.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${tx.patientId}`);
    return ok(created);
  } catch (e) {
    console.error("[createApicalSurgery]", e);
    return fail("Error al guardar cirugía apical");
  }
}
