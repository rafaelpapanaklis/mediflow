// Periodontics — server actions de firma de consentimientos. SPEC §10.3, §10.4

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { signSrpConsentSchema, signSurgeryConsentSchema } from "@/lib/periodontics/schemas";
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
 * Persiste la firma del consentimiento informado de SRP.
 * Crea un PatientFile con category=CONSENT y description="SRP" usando
 * la signatureUrl (data: URL del SignaturePad o URL firmada de storage).
 * El consentimiento queda asociado al paciente y disponible en su expediente.
 */
export async function signSrpConsent(
  input: unknown,
): Promise<ActionResult<{ fileId: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = signSrpConsentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  try {
    const file = await prisma.patientFile.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        category: "CONSENT_FORM",
        name: `consent-srp-${Date.now()}.png`,
        url: parsed.data.signatureUrl,
        mimeType: "image/png",
        uploadedBy: ctx.userId,
        notes: "Consentimiento informado SRP — Periodontología",
      },
      select: { id: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.CONSENT_SRP_SIGNED,
      entityType: "PatientFile",
      entityId: file.id,
      after: { patientId: parsed.data.patientId, kind: "SRP" },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ fileId: file.id });
  } catch (e) {
    console.error("[perio consents] signSrpConsent failed:", e);
    return fail("No se pudo guardar el consentimiento");
  }
}

/**
 * Persiste la firma del consentimiento informado de cirugía periodontal y
 * lo enlaza a la `PeriodontalSurgery` correspondiente vía
 * `consentSignedFileId`. Si la cirugía aún no estaba firmada, ahora queda
 * marcada como firmada.
 */
export async function signSurgeryConsent(
  input: unknown,
): Promise<ActionResult<{ fileId: string; surgeryId: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = signSurgeryConsentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const surgery = await prisma.periodontalSurgery.findFirst({
    where: { id: parsed.data.surgeryId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true, surgeryType: true },
  });
  if (!surgery) return fail("Cirugía no encontrada");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const file = await tx.patientFile.create({
        data: {
          clinicId: ctx.clinicId,
          patientId: surgery.patientId,
          category: "CONSENT_FORM",
          name: `consent-surgery-${surgery.surgeryType.toLowerCase()}-${Date.now()}.png`,
          url: parsed.data.signatureUrl,
          mimeType: "image/png",
          uploadedBy: ctx.userId,
          notes: `Consentimiento cirugía periodontal — ${surgery.surgeryType}`,
        },
        select: { id: true },
      });

      await tx.periodontalSurgery.update({
        where: { id: surgery.id },
        data: { consentSignedFileId: file.id },
      });

      return { fileId: file.id };
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.CONSENT_SURGERY_SIGNED,
      entityType: "PeriodontalSurgery",
      entityId: surgery.id,
      after: {
        fileId: result.fileId,
        surgeryType: surgery.surgeryType,
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${surgery.patientId}`);
    return ok({ fileId: result.fileId, surgeryId: surgery.id });
  } catch (e) {
    console.error("[perio consents] signSurgeryConsent failed:", e);
    return fail("No se pudo guardar el consentimiento");
  }
}
