"use server";
// Implants — updateImplantStatus. Valida transición contra status-machine.
// Para REMOVED redirige a removeImplant (no permite cambio directo aquí
// porque REMOVED requiere removalReason ≥20 chars). Spec §5.

import { prisma } from "@/lib/prisma";
import {
  updateImplantStatusSchema,
  type UpdateImplantStatusInput,
} from "@/lib/validation/implants";
import { isValidTransition } from "@/lib/implants/status-machine";
import { IMPLANT_AUDIT_ACTIONS } from "./audit-actions";
import {
  auditImplant,
  getImplantActionContext,
  loadImplantForCtx,
  revalidateImplantPaths,
} from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function updateImplantStatus(
  input: UpdateImplantStatusInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateImplantStatusSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");
  }

  if (parsed.data.newStatus === "REMOVED") {
    return fail(
      "Para REMOVED usa la action removeImplant (requiere motivo ≥20 chars)",
    );
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

  if (!isValidTransition(before.currentStatus, parsed.data.newStatus)) {
    return fail(
      `Transición inválida: ${before.currentStatus} → ${parsed.data.newStatus}`,
    );
  }

  try {
    const updated = await prisma.implant.update({
      where: { id: before.id },
      data: {
        currentStatus: parsed.data.newStatus,
        statusUpdatedAt: new Date(),
      },
      select: { id: true, patientId: true, currentStatus: true },
    });

    await auditImplant({
      ctx,
      action: IMPLANT_AUDIT_ACTIONS.IMPLANT_STATUS_CHANGED,
      entityType: "implant",
      entityId: updated.id,
      before: { currentStatus: before.currentStatus },
      after: { currentStatus: updated.currentStatus },
      meta: parsed.data.reason ? { reason: parsed.data.reason } : undefined,
    });

    revalidateImplantPaths({ patientId: updated.patientId });
    return ok({ id: updated.id });
  } catch (e) {
    console.error("[updateImplantStatus]", e);
    return fail("Error al actualizar estado del implante");
  }
}
