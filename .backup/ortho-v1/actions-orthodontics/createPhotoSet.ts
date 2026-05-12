"use server";
// Orthodontics — action 9/15: createPhotoSet (T0/T1/T2/CONTROL). SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createPhotoSetSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createPhotoSet(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createPhotoSetSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: {
      id: parsed.data.treatmentPlanId,
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      deletedAt: null,
    },
    include: { photoSets: { select: { setType: true } } },
  });
  if (!plan) return fail("Plan no encontrado");

  // T0/T1/T2 son singleton por plan. CONTROL puede repetirse.
  if (parsed.data.setType !== "CONTROL") {
    const dup = plan.photoSets.some((s) => s.setType === parsed.data.setType);
    if (dup) return fail(`Ya existe un set ${parsed.data.setType} para este plan`);
    if (parsed.data.setType !== "T0" && !plan.photoSets.some((s) => s.setType === "T0")) {
      return fail("No puedes crear T1/T2 antes de capturar T0");
    }
  }

  try {
    const created = await prisma.orthoPhotoSet.create({
      data: {
        treatmentPlanId: parsed.data.treatmentPlanId,
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        capturedById: ctx.userId,
        setType: parsed.data.setType,
        capturedAt: new Date(parsed.data.capturedAt),
        monthInTreatment: parsed.data.monthInTreatment ?? null,
        notes: parsed.data.notes ?? null,
      },
      select: { id: true, setType: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.PHOTO_SET_CREATED,
      entityType: "OrthoPhotoSet",
      entityId: created.id,
      after: { setType: created.setType, treatmentPlanId: parsed.data.treatmentPlanId },
    });

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);

    return ok({ id: created.id });
  } catch (e) {
    console.error("[ortho] createPhotoSet failed:", e);
    return fail("No se pudo crear el set fotográfico");
  }
}
