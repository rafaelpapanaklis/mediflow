"use server";
// Implants — createSecondStageSurgery (descubrimiento 2ª fase, protocolo
// TWO_STAGE). Spec §6.10, §7.4. Cambia status a UNCOVERED.

import { prisma } from "@/lib/prisma";
import {
  createSecondStageSurgerySchema,
  type CreateSecondStageSurgeryInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createSecondStageSurgery(
  input: CreateSecondStageSurgeryInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSecondStageSurgerySchema.safeParse(input);
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

  // Verifica protocolo
  const implant = await prisma.implant.findUnique({
    where: { id: before.id },
    select: { protocol: true },
  });
  if (implant?.protocol !== "TWO_STAGE") {
    return fail(
      "createSecondStageSurgery solo aplica a protocolo TWO_STAGE",
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const surgery = await tx.implantSecondStageSurgery.create({
        data: {
          implantId: parsed.data.implantId,
          performedAt: parsed.data.performedAt,
          technique: parsed.data.technique,
          healingAbutmentLot: parsed.data.healingAbutmentLot,
          healingAbutmentDiameterMm: parsed.data.healingAbutmentDiameterMm,
          healingAbutmentHeightMm: parsed.data.healingAbutmentHeightMm,
          isqAtUncovering: parsed.data.isqAtUncovering ?? null,
          durationMinutes: parsed.data.durationMinutes,
          notes: parsed.data.notes ?? null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });

      await tx.implant.update({
        where: { id: parsed.data.implantId },
        data: {
          currentStatus: "UNCOVERED",
          statusUpdatedAt: new Date(),
        },
      });

      return { id: surgery.id };
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.SECOND_STAGE_CREATED,
      entityType: "implant.secondStage",
      entityId: result.id,
      after: {
        implantId: parsed.data.implantId,
        technique: parsed.data.technique,
        healingAbutmentLot: parsed.data.healingAbutmentLot,
      },
    });
    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.IMPLANT_STATUS_CHANGED,
      entityType: "implant",
      entityId: parsed.data.implantId,
      before: { currentStatus: before.currentStatus },
      after: { currentStatus: "UNCOVERED" },
    });

    revalidateImplantPaths({ patientId: before.patientId });
    return ok({ id: result.id });
  } catch (e) {
    console.error("[createSecondStageSurgery]", e);
    return fail("Error al guardar segunda cirugía");
  }
}
