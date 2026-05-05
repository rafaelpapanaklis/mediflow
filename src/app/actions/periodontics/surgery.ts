// Periodontics — server action: cirugía periodontal. SPEC §5.2

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createPeriodontalSurgerySchema } from "@/lib/periodontics/schemas";
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

/**
 * Registra una cirugía periodontal con biomateriales y sitios tratados.
 * Si se provee `consentSignedFileId`, se asume que el paciente ya firmó —
 * el flujo de firma está en `consents.ts` (commit C9).
 */
export async function createPeriodontalSurgery(
  input: unknown,
): Promise<ActionResult<{ id: string; surgeryType: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createPeriodontalSurgerySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  // Si se enlazó un plan, verificar que pertenezca al paciente.
  if (parsed.data.planId) {
    const plan = await prisma.periodontalTreatmentPlan.findFirst({
      where: { id: parsed.data.planId, clinicId: ctx.clinicId, deletedAt: null },
      select: { id: true, patientId: true },
    });
    if (!plan || plan.patientId !== parsed.data.patientId) {
      return fail("Plan no corresponde al paciente");
    }
  }

  try {
    const created = await prisma.periodontalSurgery.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        planId: parsed.data.planId ?? null,
        surgeryType: parsed.data.surgeryType,
        treatedSites: parsed.data.treatedSites,
        biomaterials: parsed.data.biomaterials ?? undefined,
        sutureType: parsed.data.sutureType ?? null,
        surgeryDate: new Date(parsed.data.surgeryDate),
        doctorId: ctx.userId,
        consentSignedFileId: parsed.data.consentSignedFileId ?? null,
        intraoperativeFileId: parsed.data.intraoperativeFileId ?? null,
      },
      select: { id: true, surgeryType: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.SURGERY_CREATED,
      entityType: "PeriodontalSurgery",
      entityId: created.id,
      after: {
        surgeryType: created.surgeryType,
        teeth: parsed.data.treatedSites.map((t) => t.fdi),
        hasConsent: Boolean(parsed.data.consentSignedFileId),
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ id: created.id, surgeryType: created.surgeryType });
  } catch (e) {
    console.error("[perio surgery] create failed:", e);
    return fail("No se pudo registrar la cirugía");
  }
}
