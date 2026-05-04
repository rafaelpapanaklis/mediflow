// Periodontics — server actions de recesiones gingivales (Cairo 2018). SPEC §5.2

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createGingivalRecessionSchema } from "@/lib/periodontics/schemas";
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

/** Crea un registro de recesión gingival con clasificación Cairo 2018. */
export async function createGingivalRecession(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createGingivalRecessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  try {
    const created = await prisma.gingivalRecession.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        toothFdi: parsed.data.toothFdi,
        surface: parsed.data.surface,
        recessionHeightMm: parsed.data.recessionHeightMm,
        recessionWidthMm: parsed.data.recessionWidthMm,
        keratinizedTissueMm: parsed.data.keratinizedTissueMm,
        cairoClassification: parsed.data.cairoClassification,
        gingivalPhenotype: parsed.data.gingivalPhenotype,
        notes: parsed.data.notes ?? null,
        recordedById: ctx.userId,
      },
      select: { id: true, toothFdi: true, cairoClassification: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.RECESSION_CREATED,
      entityType: "GingivalRecession",
      entityId: created.id,
      after: { toothFdi: created.toothFdi, cairo: created.cairoClassification },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ id: created.id });
  } catch (e) {
    console.error("[perio recession] create failed:", e);
    return fail("No se pudo guardar la recesión");
  }
}

/**
 * Marca una recesión como resuelta (post-cirugía coronally advanced / injerto).
 * No la elimina, sólo setea `resolvedAt`. Auditable.
 */
export async function resolveGingivalRecession(
  recessionId: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  if (typeof recessionId !== "string" || !recessionId) return fail("recessionId requerido");

  const before = await prisma.gingivalRecession.findFirst({
    where: { id: recessionId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, resolvedAt: true },
  });
  if (!before) return fail("Recesión no encontrada");

  try {
    const next = await prisma.gingivalRecession.update({
      where: { id: before.id },
      data: { resolvedAt: new Date() },
      select: { id: true, patientId: true, resolvedAt: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.RECESSION_UPDATED,
      entityType: "GingivalRecession",
      entityId: next.id,
      before: { resolvedAt: before.resolvedAt },
      after: { resolvedAt: next.resolvedAt },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${next.patientId}`);
    return ok({ id: next.id });
  } catch (e) {
    console.error("[perio recession] resolve failed:", e);
    return fail("No se pudo marcar la recesión como resuelta");
  }
}
