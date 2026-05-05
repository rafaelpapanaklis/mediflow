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
 * `implantId` ahora es FK real al modelo `Implant` (stub creado en A2
 * cross-módulos). Se mantiene nullable: si el caller solo pasa `implantFdi`
 * sin id explícito, intentamos resolver por (clinicId, patientId, toothFdi)
 * y, si no existe, creamos un Implant stub on-the-fly. Esto preserva la
 * flexibilidad histórica antes de que llegue el módulo de Implantología (4/5).
 * SPEC §1.17.
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

  // Resuelve implantId. Si el caller pasa uno explícito, valida que exista
  // dentro del clinic. Si solo pasa implantFdi, busca un Implant existente
  // o crea uno stub para preservar la FK.
  let resolvedImplantId: string | null = parsed.data.implantId ?? null;
  if (resolvedImplantId) {
    const exists = await prisma.implant.findFirst({
      where: { id: resolvedImplantId, clinicId: ctx.clinicId, patientId: parsed.data.patientId },
      select: { id: true },
    });
    if (!exists) return fail("El implante referenciado no existe en esta clínica");
  } else {
    const existing = await prisma.implant.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        toothFdi: parsed.data.implantFdi,
        deletedAt: null,
      },
      orderBy: { placedAt: "desc" },
      select: { id: true },
    });
    if (existing) {
      resolvedImplantId = existing.id;
    } else {
      const created = await prisma.implant.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: parsed.data.patientId,
          toothFdi: parsed.data.implantFdi,
        },
        select: { id: true },
      });
      resolvedImplantId = created.id;
    }
  }

  try {
    const created = await prisma.periImplantAssessment.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        implantId: resolvedImplantId,
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
