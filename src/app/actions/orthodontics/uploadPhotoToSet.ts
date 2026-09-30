"use server";
// Orthodontics — action 10/15: uploadPhotoToSet (asocia PatientFile ya subido a la columna del set). SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { uploadPhotoToSetSchema } from "@/lib/validation/orthodontics";
import { VIEW_TO_ID_COLUMN, motivoArchivoAjenoAlJuego } from "@/lib/orthodontics/photo-set-helpers";
import { conMovimientosSoloDeBitacora, conUnSoloMovimiento, esPasoDeOtraAccion } from "@/lib/movimientos-paciente/una-accion";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function uploadPhotoToSet(input: unknown): Promise<ActionResult<{ setId: string }>> {
  // Un solo movimiento por foto subida: si la foto viene de una subida (`parteDeUnaAccion`), su fila la deja la subida
  // y esta queda solo en la bitácora; si se ligó una foto que ya estaba, esta es la fila y dice si creó el juego.
  if (esPasoDeOtraAccion(input)) return conMovimientosSoloDeBitacora(() => ligarFotoAlJuego(input));
  const juegoNuevo = Boolean(input && typeof input === "object" && (input as { juegoNuevo?: unknown }).juegoNuevo === true);
  return conUnSoloMovimiento(
    { titulo: "Subió una foto de ortodoncia", detallesExtra: juegoNuevo ? ["Creó un juego de fotos de ortodoncia"] : [] },
    () => ligarFotoAlJuego(input),
  );
}

async function ligarFotoAlJuego(input: unknown): Promise<ActionResult<{ setId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = uploadPhotoToSetSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const set = await prisma.orthoPhotoSet.findFirst({
    where: { id: parsed.data.setId, clinicId: ctx.clinicId },
  });
  if (!set) return fail("Set fotográfico no encontrado");

  // X6: el archivo tiene que ser del MISMO paciente que el juego (antes solo
  // se miraba la clínica y se podía colgar la foto de otro paciente).
  const file = await prisma.patientFile.findFirst({
    where: { id: parsed.data.fileId, clinicId: ctx.clinicId, deletedAt: null },
    select: { clinicId: true, patientId: true },
  });
  const archivoAjeno = motivoArchivoAjenoAlJuego(set, file);
  if (archivoAjeno) return fail(archivoAjeno);

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
      patientId: set.patientId,
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
