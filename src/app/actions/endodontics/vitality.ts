"use server";
// Endodontics — server action para VitalityTest. Spec §5.3

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  recordVitalitySchema,
  type RecordVitalityInput,
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

export async function recordVitalityTest(
  input: RecordVitalityInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = recordVitalitySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctxRes = await getEndoActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const patientRes = await loadPatientForEndo({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patientRes)) return patientRes;

  try {
    const created = await prisma.vitalityTest.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        doctorId: ctx.userId,
        toothFdi: parsed.data.toothFdi,
        controlTeeth: parsed.data.controlTeeth,
        testType: parsed.data.testType,
        result: parsed.data.result,
        intensity: parsed.data.intensity ?? null,
        notes: parsed.data.notes ?? null,
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });

    await auditEndo({
      ctx,
      action: ENDO_AUDIT_ACTIONS.VITALITY_RECORDED,
      entityType: "endo-vitality",
      entityId: created.id,
      after: {
        toothFdi: parsed.data.toothFdi,
        testType: parsed.data.testType,
        result: parsed.data.result,
      },
    });
    revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/endodontics/${parsed.data.patientId}`);
    return ok(created);
  } catch (e) {
    console.error("[recordVitalityTest]", e);
    return fail("Error al registrar prueba de vitalidad");
  }
}
