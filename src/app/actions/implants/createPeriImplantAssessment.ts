"use server";
// Implants — createPeriImplantAssessment STUB.
//
// PENDIENTE FUTURO: el modelo PeriImplantAssessment vive en el módulo
// Periodoncia (3/5), branch feature/periodontics-module-v1. Este branch
// (feature/implant-module-v1) sale de origin/feature/endodontics-module-v1
// y NO tiene acceso a ese modelo. Spec §1.20.
//
// Cuando ambos módulos se mergeen en main:
//   1. Eliminar este STUB.
//   2. Reescribir como acción real que crea PeriImplantAssessment.
//   3. Migración SQL separada para FK real
//      PeriImplantAssessment.implantId → Implant.id (Spec §1.21).
//
// El audit log registra el llamado para que quede trazabilidad de
// que el flujo se intentó.

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

export type PeriImplantStubResult = {
  stub: true;
  todo: string;
};

export async function createPeriImplantAssessment(
  input: CreatePeriImplantAssessmentInput,
): Promise<ActionResult<PeriImplantStubResult>> {
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

  // Audit del STUB para trazabilidad — el doctor intentó crear
  // assessment periimplantar pero el módulo Periodoncia aún no está
  // integrado.
  await auditImplant({
    ctx,
    action: IMPLANT_AUDIT_ACTIONS.PERI_IMPLANT_ASSESSMENT_STUB,
    entityType: "implant",
    entityId: parsed.data.implantId,
    meta: {
      stub: true,
      reason: "PeriImplantAssessment vive en módulo Periodoncia (no integrado todavía)",
      input: {
        bopPresent: parsed.data.bopPresent,
        pdMaxMm: parsed.data.pdMaxMm,
        suppurationPresent: parsed.data.suppurationPresent,
        radiographicBoneLossMm: parsed.data.radiographicBoneLossMm,
      },
    },
  });

  return ok({
    stub: true,
    todo:
      "Implementar al integrar el módulo Periodoncia. " +
      "Migración SQL FK PeriImplantAssessment.implantId → Implant.id " +
      "se ejecuta en commit separado.",
  });
}
