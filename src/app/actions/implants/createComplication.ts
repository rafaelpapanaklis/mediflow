"use server";
// Implants — createComplication. Spec §6.12, §7.3.
// Al guardar cambia currentStatus → COMPLICATION.

import { prisma } from "@/lib/prisma";
import {
  createComplicationSchema,
  type CreateComplicationInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createComplication(
  input: CreateComplicationInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createComplicationSchema.safeParse(input);
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
  const before = implantRes.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const complication = await tx.implantComplication.create({
        data: {
          implantId: parsed.data.implantId,
          clinicId: before.clinicId,
          patientId: before.patientId,
          detectedAt: parsed.data.detectedAt,
          type: parsed.data.type,
          severity: parsed.data.severity,
          description: parsed.data.description,
          bopAtDiagnosis: parsed.data.bopAtDiagnosis ?? null,
          pdMaxAtDiagnosisMm: parsed.data.pdMaxAtDiagnosisMm ?? null,
          suppurationAtDiagnosis: parsed.data.suppurationAtDiagnosis ?? null,
          radiographicBoneLossMm: parsed.data.radiographicBoneLossMm ?? null,
          treatmentPlan: parsed.data.treatmentPlan ?? null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });

      // Cambia status a COMPLICATION solo si no está ya en estados
      // terminales (FAILED, REMOVED).
      if (before.currentStatus !== "FAILED" && before.currentStatus !== "REMOVED") {
        await tx.implant.update({
          where: { id: parsed.data.implantId },
          data: {
            currentStatus: "COMPLICATION",
            statusUpdatedAt: new Date(),
          },
        });
      }

      return { id: complication.id };
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.COMPLICATION_CREATED,
      entityType: "implant.complication",
      entityId: result.id,
      after: {
        implantId: parsed.data.implantId,
        type: parsed.data.type,
        severity: parsed.data.severity,
        bop: parsed.data.bopAtDiagnosis,
        pdMax: parsed.data.pdMaxAtDiagnosisMm,
        boneLoss: parsed.data.radiographicBoneLossMm,
      },
    });
    if (before.currentStatus !== "FAILED" && before.currentStatus !== "REMOVED") {
      await auditImplant({
        ctx,
        action: IMPLANT_AUDIT_ACTIONS.IMPLANT_STATUS_CHANGED,
        entityType: "implant",
        entityId: parsed.data.implantId,
        before: { currentStatus: before.currentStatus },
        after: { currentStatus: "COMPLICATION" },
      });
    }

    revalidateImplantPaths({ patientId: before.patientId });
    return ok({ id: result.id });
  } catch (e) {
    console.error("[createComplication]", e);
    return fail("Error al registrar complicación");
  }
}
