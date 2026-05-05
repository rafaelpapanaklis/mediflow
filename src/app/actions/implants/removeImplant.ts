"use server";
// Implants — removeImplant. Spec §1.10. La semántica de "borrar" es
// cambiar `currentStatus` a REMOVED + `removalReason` ≥20 chars +
// `removedAt`. NUNCA usa prisma.delete() (DELETE bloqueado por trigger
// SQL `block_implant_delete`).

import { prisma } from "@/lib/prisma";
import {
  removeImplantSchema,
  type RemoveImplantInput,
} from "@/lib/validation/implants";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function removeImplant(
  input: RemoveImplantInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = removeImplantSchema.safeParse(input);
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

  if (before.currentStatus === "REMOVED") {
    return fail("Implante ya está removido");
  }

  try {
    const now = new Date();
    const updated = await prisma.implant.update({
      where: { id: before.id },
      data: {
        currentStatus: "REMOVED",
        statusUpdatedAt: now,
        removedAt: now,
        removalReason: parsed.data.removalReason,
        removalSurgeryRecordId: parsed.data.removalSurgeryRecordId ?? null,
      },
      select: { id: true, patientId: true, currentStatus: true },
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.IMPLANT_REMOVED,
      entityType: "implant",
      entityId: updated.id,
      before: { currentStatus: before.currentStatus },
      after: { currentStatus: "REMOVED" },
      meta: {
        removalReason: parsed.data.removalReason,
        removedAt: now.toISOString(),
      },
    });

    revalidateImplantPaths({ patientId: updated.patientId });
    return ok({ id: updated.id });
  } catch (e) {
    console.error("[removeImplant]", e);
    return fail("Error al remover implante");
  }
}
