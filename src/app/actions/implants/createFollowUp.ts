"use server";
// Implants — createFollowUp (visita de mantenimiento periimplantario).
// Spec §6.16. Si el follow-up tiene performedAt y mediciones, se evalúa
// Albrektsson y se persiste meetsAlbrektssonCriteria.

import { prisma } from "@/lib/prisma";
import {
  createFollowUpSchema,
  type CreateFollowUpInput,
} from "@/lib/validation/implants";
import {
  evaluateAlbrektsson,
  yearsBetween,
} from "@/lib/implants/albrektsson-success";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createFollowUp(
  input: CreateFollowUpInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createFollowUpSchema.safeParse(input);
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

  // Si tenemos performedAt + radiographicBoneLossMm, autoevaluamos.
  let meetsAlbrektsson: boolean | null = parsed.data.meetsAlbrektssonCriteria ?? null;
  if (
    meetsAlbrektsson === null &&
    parsed.data.performedAt &&
    parsed.data.radiographicBoneLossMm !== undefined
  ) {
    const years = yearsBetween(before.placedAt, parsed.data.performedAt);
    meetsAlbrektsson = evaluateAlbrektsson(
      parsed.data.radiographicBoneLossMm,
      years,
    ).meetsCriteria;
  }

  try {
    const created = await prisma.implantFollowUp.create({
      data: {
        implantId: parsed.data.implantId,
        clinicId: before.clinicId,
        milestone: parsed.data.milestone,
        scheduledAt: parsed.data.scheduledAt ?? null,
        performedAt: parsed.data.performedAt ?? null,
        bopPresent: parsed.data.bopPresent ?? null,
        pdMaxMm: parsed.data.pdMaxMm ?? null,
        suppuration: parsed.data.suppuration ?? null,
        mobility: parsed.data.mobility ?? null,
        occlusionStable: parsed.data.occlusionStable ?? null,
        radiographicBoneLossMm: parsed.data.radiographicBoneLossMm ?? null,
        meetsAlbrektssonCriteria: meetsAlbrektsson,
        radiographFileId: parsed.data.radiographFileId ?? null,
        nextControlAt: parsed.data.nextControlAt ?? null,
        notes: parsed.data.notes ?? null,
        createdByUserId: ctx.userId,
      },
      select: { id: true },
    });

    const auditAction = parsed.data.performedAt
      ? IMPLANT_AUDIT_ACTIONS.FOLLOWUP_COMPLETED
      : IMPLANT_AUDIT_ACTIONS.FOLLOWUP_CREATED;

    await auditImplant({
      ctx,
      action: auditAction,
      entityType: "implant.followup",
      entityId: created.id,
      after: {
        implantId: parsed.data.implantId,
        milestone: parsed.data.milestone,
        performedAt: parsed.data.performedAt?.toISOString() ?? null,
        boneLoss: parsed.data.radiographicBoneLossMm ?? null,
        meetsAlbrektsson,
      },
    });

    revalidateImplantPaths({ patientId: before.patientId });
    return ok({ id: created.id });
  } catch (e) {
    console.error("[createFollowUp]", e);
    return fail("Error al guardar control");
  }
}
