// Periodontics — server action: evaluación periimplantar. SPEC §5.2

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createPeriImplantAssessmentSchema } from "@/lib/periodontics/schemas";
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
 * Crea una evaluación periimplantar (salud / mucositis / periimplantitis).
 * `implantId` es nullable: el módulo de implantología aún no existe (4/5),
 * por eso aceptamos referencias por `implantFdi`. SPEC §1.17.
 */
export async function createPeriImplantAssessment(
  input: unknown,
): Promise<ActionResult<{ id: string; status: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createPeriImplantAssessmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  try {
    const created = await prisma.periImplantAssessment.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        implantId: parsed.data.implantId ?? null,
        implantFdi: parsed.data.implantFdi,
        status: parsed.data.status,
        bop: parsed.data.bop,
        suppuration: parsed.data.suppuration,
        radiographicBoneLossMm: parsed.data.radiographicBoneLossMm ?? null,
        recommendedTreatment: parsed.data.recommendedTreatment ?? null,
        evaluatedById: ctx.userId,
      },
      select: { id: true, status: true, implantFdi: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.PERI_IMPLANT_ASSESSED,
      entityType: "PeriImplantAssessment",
      entityId: created.id,
      after: {
        implantFdi: created.implantFdi,
        status: created.status,
        bop: parsed.data.bop,
        suppuration: parsed.data.suppuration,
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ id: created.id, status: created.status });
  } catch (e) {
    console.error("[perio peri-implant] create failed:", e);
    return fail("No se pudo guardar la evaluación periimplantar");
  }
}
