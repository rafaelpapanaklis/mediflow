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
 * Resolución de `implantId`:
 *   - Si el caller pasa un `implantId` explícito, valida que exista en
 *     la clínica + paciente. Si no existe → reject con error claro.
 *   - Si solo pasa `implantFdi`, busca por (clinicId, patientId, toothFdi).
 *     Si no encuentra → reject. La creación de Implant es responsabilidad
 *     del módulo Implantología (4/5).
 *
 * Los queries van por `$queryRaw` porque este branch (A2) no declara el
 * modelo Prisma `Implant` — ese lo aporta `feature/implant-module-v1`
 * tras el merge. La columna FK `peri_implant_assessments.implantId →
 * implants(id)` la agrega la migración 20260505100000_dental_cross_modules.
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

  // Resuelve implantId vía SQL raw. La tabla `implants` debe existir
  // (aportada por el módulo Implantología). Si no existe, los queries
  // fallan — caso esperado en un branch standalone sin merge con
  // feature/implant-module-v1.
  let resolvedImplantId: string | null = null;
  if (parsed.data.implantId) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "implants"
      WHERE "id" = ${parsed.data.implantId}
        AND "clinicId" = ${ctx.clinicId}
        AND "patientId" = ${parsed.data.patientId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return fail("El implante referenciado no existe en esta clínica");
    }
    resolvedImplantId = rows[0].id;
  } else {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "implants"
      WHERE "clinicId" = ${ctx.clinicId}
        AND "patientId" = ${parsed.data.patientId}
        AND "toothFdi" = ${parsed.data.implantFdi}
        AND "removedAt" IS NULL
      ORDER BY "placedAt" DESC NULLS LAST
      LIMIT 1
    `;
    if (rows.length === 0) {
      return fail(
        `No existe implante registrado para diente ${parsed.data.implantFdi}. Crea el implante primero desde el módulo de Implantología.`,
      );
    }
    resolvedImplantId = rows[0].id;
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
