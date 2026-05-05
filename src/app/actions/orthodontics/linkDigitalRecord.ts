"use server";
// Orthodontics — action 12/15: linkDigitalRecord (PDF cefalo o STL scan). SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { linkDigitalRecordSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function linkDigitalRecord(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = linkDigitalRecordSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const file = await prisma.patientFile.findFirst({
    where: { id: parsed.data.fileId, clinicId: ctx.clinicId },
  });
  if (!file) return fail("Archivo no encontrado");

  // Validar consistencia: CEPH_ANALYSIS_PDF debe ser categoría correcta.
  if (
    parsed.data.recordType === "CEPH_ANALYSIS_PDF" &&
    file.category !== "CEPH_ANALYSIS_PDF"
  ) {
    return fail("El archivo no está marcado como CEPH_ANALYSIS_PDF");
  }
  if (parsed.data.recordType === "SCAN_STL" && file.category !== "SCAN_STL") {
    return fail("El archivo no está marcado como SCAN_STL");
  }

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
    const created = await prisma.orthodonticDigitalRecord.create({
      data: {
        treatmentPlanId: parsed.data.treatmentPlanId,
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        recordType: parsed.data.recordType,
        fileId: parsed.data.fileId,
        capturedAt: new Date(parsed.data.capturedAt),
        uploadedById: ctx.userId,
        notes: parsed.data.notes ?? null,
      },
      select: { id: true, recordType: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.DIGITAL_RECORD_LINKED,
      entityType: "OrthodonticDigitalRecord",
      entityId: created.id,
      after: { recordType: created.recordType, fileId: parsed.data.fileId },
    });

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);

    return ok({ id: created.id });
  } catch (e) {
    console.error("[ortho] linkDigitalRecord failed:", e);
    return fail("No se pudo vincular el archivo digital");
  }
}
