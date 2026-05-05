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
 *
 * Resolución de `implantId` (cross-tenant safe):
 *   - Si el caller pasa un `implantId` explícito → valida que exista en
 *     `(clinicId, patientId)`. Si no → reject con error claro.
 *   - Si solo pasa `implantFdi` → busca por `(clinicId, patientId, toothFdi)`,
 *     filtrando removidos. Si no encuentra → reject. Crear el implante es
 *     responsabilidad del módulo Implantología (4/5).
 *
 * Tras el merge A3 con feature/implant-module-v1 el modelo Prisma `Implant`
 * existe — usamos `prisma.implant.*` directo. La columna FK
 * `peri_implant_assessments.implantId → implants(id)` la agrega la
 * migración 20260505100000_dental_cross_modules. SPEC §1.17.
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

  let resolvedImplantId: string | null = null;
  if (parsed.data.implantId) {
    const found = await prisma.implant.findFirst({
      where: {
        id: parsed.data.implantId,
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
      },
      select: { id: true },
    });
    if (!found) {
      return fail("El implante referenciado no existe en esta clínica");
    }
    resolvedImplantId = found.id;
  } else {
    const found = await prisma.implant.findFirst({
      where: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        toothFdi: parsed.data.implantFdi,
        removedAt: null,
      },
      orderBy: { placedAt: "desc" },
      select: { id: true },
    });
    if (!found) {
      return fail(
        `No existe implante registrado para diente ${parsed.data.implantFdi}. Crea el implante primero desde el módulo de Implantología.`,
      );
    }
    resolvedImplantId = found.id;
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
