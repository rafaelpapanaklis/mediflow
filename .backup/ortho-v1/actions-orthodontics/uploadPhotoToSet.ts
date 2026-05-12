"use server";
// Orthodontics — action 10/15: uploadPhotoToSet (asocia PatientFile ya subido a la columna del set). SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { uploadPhotoToSetSchema } from "@/lib/validation/orthodontics";
import { VIEW_TO_ID_COLUMN } from "@/lib/orthodontics/photo-set-helpers";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function uploadPhotoToSet(
  input: unknown,
): Promise<ActionResult<{ setId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = uploadPhotoToSetSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const set = await prisma.orthoPhotoSet.findFirst({
    where: { id: parsed.data.setId, clinicId: ctx.clinicId },
  });
  if (!set) return fail("Set fotográfico no encontrado");

  const file = await prisma.patientFile.findFirst({
    where: { id: parsed.data.fileId, clinicId: ctx.clinicId },
  });
  if (!file) return fail("Archivo no encontrado");

  const column = VIEW_TO_ID_COLUMN[parsed.data.view];

  try {
    await prisma.orthoPhotoSet.update({
      where: { id: set.id },
      data: { [column]: parsed.data.fileId },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.PHOTO_UPLOADED,
      entityType: "OrthoPhotoSet",
      entityId: set.id,
      meta: { view: parsed.data.view, fileId: parsed.data.fileId },
    });

    revalidatePath(`/dashboard/patients/${set.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${set.patientId}`);

    return ok({ setId: set.id });
  } catch (e) {
    console.error("[ortho] uploadPhotoToSet failed:", e);
    return fail("No se pudo asociar la foto al set");
  }
}
