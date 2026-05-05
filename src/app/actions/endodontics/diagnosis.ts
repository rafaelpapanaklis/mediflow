"use server";
// Endodontics — server actions para EndodonticDiagnosis. Spec §5.1, §5.2

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  createDiagnosisSchema,
  updateDiagnosisSchema,
  type CreateDiagnosisInput,
  type UpdateDiagnosisInput,
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

export async function createDiagnosis(
  input: CreateDiagnosisInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createDiagnosisSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const patientRes = await loadPatientForEndo({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patientRes)) return patientRes;

  try {
    const created = await prisma.endodonticDiagnosis.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        doctorId: ctx.userId,
        toothFdi: parsed.data.toothFdi,
        pulpalDiagnosis: parsed.data.pulpalDiagnosis,
        periapicalDiagnosis: parsed.data.periapicalDiagnosis,
        justification: parsed.data.justification ?? null,
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.DIAGNOSIS_CREATED,
      entityType: "endo-diagnosis",
      entityId: created.id,
      after: {
        toothFdi: parsed.data.toothFdi,
        pulpalDiagnosis: parsed.data.pulpalDiagnosis,
        periapicalDiagnosis: parsed.data.periapicalDiagnosis,
      },
    });
    revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${parsed.data.patientId}`);
    return ok(created);
  } catch (e) {
    console.error("[createDiagnosis]", e);
    return fail("Error al crear diagnóstico");
  }
}

export async function updateDiagnosis(
  input: UpdateDiagnosisInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateDiagnosisSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const existing = await prisma.endodonticDiagnosis.findUnique({
    where: { id: parsed.data.id },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      pulpalDiagnosis: true,
      periapicalDiagnosis: true,
      justification: true,
      toothFdi: true,
    },
  });
  if (!existing || existing.clinicId !== ctx.clinicId) {
    return fail("Diagnóstico no encontrado");
  }

  try {
    const updated = await prisma.endodonticDiagnosis.update({
      where: { id: existing.id },
      data: {
        pulpalDiagnosis: parsed.data.pulpalDiagnosis,
        periapicalDiagnosis: parsed.data.periapicalDiagnosis,
        justification: parsed.data.justification ?? null,
      },
      select: {
        id: true,
        pulpalDiagnosis: true,
        periapicalDiagnosis: true,
        justification: true,
      },
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.DIAGNOSIS_UPDATED,
      entityType: "endo-diagnosis",
      entityId: existing.id,
      before: {
        pulpalDiagnosis: existing.pulpalDiagnosis,
        periapicalDiagnosis: existing.periapicalDiagnosis,
        justification: existing.justification,
      },
      after: {
        pulpalDiagnosis: updated.pulpalDiagnosis,
        periapicalDiagnosis: updated.periapicalDiagnosis,
        justification: updated.justification,
      },
    });
    revalidatePath(`/dashboard/patients/${existing.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${existing.patientId}`);
    return ok({ id: updated.id });
  } catch (e) {
    console.error("[updateDiagnosis]", e);
    return fail("Error al actualizar diagnóstico");
  }
}
