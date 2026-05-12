"use server";
// Orthodontics — action 13/15: createOrthodonticConsent (4 tipos). SPEC §5.2 + §10.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createOrthodonticConsentSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createOrthodonticConsent(
  input: unknown,
): Promise<ActionResult<{ id: string; consentType: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createOrthodonticConsentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: {
      id: parsed.data.treatmentPlanId,
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!plan) return fail("Plan no encontrado");

  try {
    const created = await prisma.orthodonticConsent.create({
      data: {
        treatmentPlanId: parsed.data.treatmentPlanId,
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        consentType: parsed.data.consentType,
        signedAt: new Date(parsed.data.signedAt),
        signerName: parsed.data.signerName,
        signerRelationship: parsed.data.signerRelationship ?? null,
        patientSignatureImage: parsed.data.patientSignatureImage ?? null,
        guardianSignatureImage: parsed.data.guardianSignatureImage ?? null,
        signedFileId: parsed.data.signedFileId ?? null,
        notes: parsed.data.notes ?? null,
      },
      select: { id: true, consentType: true },
    });

    // Si es TREATMENT y hay signedFileId, también lo enlazamos al plan.
    if (parsed.data.consentType === "TREATMENT" && parsed.data.signedFileId) {
      await prisma.orthodonticTreatmentPlan.update({
        where: { id: parsed.data.treatmentPlanId },
        data: { signedTreatmentConsentFileId: parsed.data.signedFileId },
      });
    }

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.CONSENT_SIGNED,
      entityType: "OrthodonticConsent",
      entityId: created.id,
      after: {
        consentType: created.consentType,
        signerName: parsed.data.signerName,
        signerRelationship: parsed.data.signerRelationship,
      },
    });

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);

    return ok({ id: created.id, consentType: created.consentType });
  } catch (e) {
    console.error("[ortho] createOrthodonticConsent failed:", e);
    return fail("No se pudo guardar el consentimiento");
  }
}
