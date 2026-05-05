"use server";
// Implants — createPeriImplantAssessment.
//
// Tras la unificación de A2 cross-módulos, el modelo PeriImplantAssessment
// (de Periodoncia, módulo 3/5) tiene FK real `implantId → implants.id`.
// Esta acción crea la evaluación desde el contexto del módulo Implants
// (típicamente disparada por MaintenanceDrawer cuando hay BoP+ o
// supuración). Spec §1.20.
//
// Cross-tenant safety: `loadImplantForCtx` ya valida clinicId; aquí
// además forzamos `clinicId + patientId` desde el implante validado.
// Imposible crear un assessment para un implante de otra clínica.

import { prisma } from "@/lib/prisma";
import {
  createPeriImplantAssessmentSchema,
  type CreatePeriImplantAssessmentInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";
import type { PeriImplantStatus } from "@prisma/client";

/**
 * Deriva el `PeriImplantStatus` desde las métricas clínicas (consenso
 * AAP-EFP 2017 + Albrektsson):
 *   - Sin BoP + sin supuración + sin pérdida ósea → SALUD
 *   - BoP+ y/o supuración + pérdida ósea <1mm → MUCOSITIS
 *   - BoP+ + pérdida ósea 1–3mm → PERIIMPLANTITIS_INICIAL
 *   - BoP+ + pérdida ósea 3–5mm → PERIIMPLANTITIS_MODERADA
 *   - BoP+ + pérdida ósea ≥5mm o supuración severa → PERIIMPLANTITIS_AVANZADA
 */
function deriveStatus(args: {
  bopPresent: boolean;
  suppurationPresent: boolean;
  radiographicBoneLossMm: number;
}): PeriImplantStatus {
  const { bopPresent, suppurationPresent, radiographicBoneLossMm } = args;
  if (!bopPresent && !suppurationPresent && radiographicBoneLossMm < 1) {
    return "SALUD";
  }
  if (radiographicBoneLossMm >= 5) {
    return "PERIIMPLANTITIS_AVANZADA";
  }
  if (radiographicBoneLossMm >= 3) {
    return "PERIIMPLANTITIS_MODERADA";
  }
  if (radiographicBoneLossMm >= 1) {
    return "PERIIMPLANTITIS_INICIAL";
  }
  return "MUCOSITIS";
}

export async function createPeriImplantAssessment(
  input: CreatePeriImplantAssessmentInput,
): Promise<ActionResult<{ id: string; status: PeriImplantStatus }>> {
  const parsed = createPeriImplantAssessmentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  const implantRes = await loadImplantForCtx({
    ctx,
    implantId: parsed.data.implantId,
  });
  if (isFailure(implantRes)) return implantRes;
  const implant = implantRes.data;

  const status = deriveStatus({
    bopPresent: parsed.data.bopPresent ?? false,
    suppurationPresent: parsed.data.suppurationPresent ?? false,
    radiographicBoneLossMm: parsed.data.radiographicBoneLossMm ?? 0,
  });

  try {
    const created = await prisma.periImplantAssessment.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: implant.patientId,
        implantId: implant.id,
        implantFdi: implant.toothFdi,
        status,
        bop: parsed.data.bopPresent ?? false,
        suppuration: parsed.data.suppurationPresent ?? false,
        radiographicBoneLossMm: parsed.data.radiographicBoneLossMm ?? null,
        recommendedTreatment: parsed.data.notes ?? null,
        evaluatedById: ctx.userId,
      },
      select: { id: true, status: true },
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.PERI_IMPLANT_ASSESSMENT_CREATED,
      entityType: "implant",
      entityId: implant.id,
      meta: {
        assessmentId: created.id,
        status: created.status,
        bop: parsed.data.bopPresent ?? false,
        suppuration: parsed.data.suppurationPresent ?? false,
        radiographicBoneLossMm: parsed.data.radiographicBoneLossMm ?? null,
        pdMaxMm: parsed.data.pdMaxMm ?? null,
      },
    });

    return ok({ id: created.id, status: created.status });
  } catch (e) {
    console.error("[createPeriImplantAssessment]", e);
    return fail("Error al crear la evaluación periimplantar");
  }
}
