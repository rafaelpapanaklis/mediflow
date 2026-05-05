"use server";
// Implants — createHealingPhase / updateHealingPhase. Spec §5.
// Normalmente createSurgicalRecord ya crea la fase; esta action existe
// para uso directo y para actualizar mediciones ISQ progresivas.

import { prisma } from "@/lib/prisma";
import {
  createHealingPhaseSchema,
  type CreateHealingPhaseInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createHealingPhase(
  input: CreateHealingPhaseInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createHealingPhaseSchema.safeParse(input);
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

  try {
    // upsert porque la fase es 1:1 con implant — si ya existe (creada
    // por createSurgicalRecord), actualiza las mediciones ISQ.
    const existing = await prisma.implantHealingPhase.findUnique({
      where: { implantId: parsed.data.implantId },
      select: { id: true },
    });

    let phase: { id: string };
    let action: string;
    if (existing) {
      phase = await prisma.implantHealingPhase.update({
        where: { id: existing.id },
        data: {
          startedAt: parsed.data.startedAt,
          expectedDurationWeeks: parsed.data.expectedDurationWeeks,
          isqAt2Weeks: parsed.data.isqAt2Weeks ?? null,
          isqAt4Weeks: parsed.data.isqAt4Weeks ?? null,
          isqAt8Weeks: parsed.data.isqAt8Weeks ?? null,
          isqLatest: parsed.data.isqLatest ?? null,
          isqLatestAt: parsed.data.isqLatestAt ?? null,
          notes: parsed.data.notes ?? null,
        },
        select: { id: true },
      });
      action = IMPLANT_AUDIT_ACTIONS.HEALING_PHASE_UPDATED;
    } else {
      phase = await prisma.implantHealingPhase.create({
        data: {
          implantId: parsed.data.implantId,
          startedAt: parsed.data.startedAt,
          expectedDurationWeeks: parsed.data.expectedDurationWeeks,
          isqAt2Weeks: parsed.data.isqAt2Weeks ?? null,
          isqAt4Weeks: parsed.data.isqAt4Weeks ?? null,
          isqAt8Weeks: parsed.data.isqAt8Weeks ?? null,
          isqLatest: parsed.data.isqLatest ?? null,
          isqLatestAt: parsed.data.isqLatestAt ?? null,
          notes: parsed.data.notes ?? null,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      action = IMPLANT_AUDIT_ACTIONS.HEALING_PHASE_CREATED;
    }

    await auditImplant({
      ctx,
      action,
      entityType: "implant.healing",
      entityId: phase.id,
      after: {
        implantId: parsed.data.implantId,
        isqLatest: parsed.data.isqLatest ?? null,
      },
    });

    revalidateImplantPaths({ patientId: implantRes.data.patientId });
    return ok({ id: phase.id });
  } catch (e) {
    console.error("[createHealingPhase]", e);
    return fail("Error al guardar fase de cicatrización");
  }
}
