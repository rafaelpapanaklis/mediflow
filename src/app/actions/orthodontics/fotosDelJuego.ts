"use server";
// Ortodoncia — quitar una foto de una vista y fotos extra de un juego (ws1-t12).
//
// NOM-004: nada se borra en silencio. «Quitar» deja libre la vista (o marca la
// extra como quitada) y anota quién, cuándo y por qué; el archivo y su fila en
// patient_files se quedan. Las tablas nuevas (sql/ortodoncia-fotos-quitadas-y-
// extra.sql) las pega Rafael: sin ellas estas acciones responden un aviso claro
// y NO tocan el juego.
//
// clinicId y usuario SIEMPRE de la sesión.

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canViewPatient } from "@/lib/patient-visibility";
import { motivoArchivoAjenoAlJuego } from "@/lib/orthodontics/photo-set-helpers";
import {
  EXTRAS_MAX_POR_JUEGO,
  MENSAJE_SIN_TABLA_DE_FOTOS,
  columnaDeVista,
  faltaLaTablaDeFotos,
  limpiarEtiqueta,
  limpiarMotivo,
} from "@/lib/orthodontics/fotos-del-juego";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

type Ctx = Extract<Awaited<ReturnType<typeof getOrthoActionContext>>, { ok: true }>["data"]["ctx"];

/** El juego, de esta clínica y de un paciente que quien pregunta puede ver. Si no, «no encontrado». */
async function cargarJuego(ctx: Ctx, setId: unknown) {
  if (typeof setId !== "string" || !setId || !ctx.clinicId) return null;
  const set = await prisma.orthoPhotoSet.findFirst({
    where: { id: setId, clinicId: ctx.clinicId },
  });
  if (!set) return null;
  const visible = await canViewPatient(set.patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  return visible ? set : null;
}

function revalidarFicha(patientId: string) {
  revalidatePath(`/dashboard/patients/${patientId}/orthodontics`);
  revalidatePath(`/dashboard/specialties/orthodontics/${patientId}`);
}

/** Quita la foto de una de las vistas: la vista queda libre y la bitácora conserva el archivo. */
export async function quitarFotoDeVista(input: {
  setId: string;
  slotId: string;
  motivo?: string | null;
}): Promise<ActionResult<{ setId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const columna = columnaDeVista(String(input?.slotId ?? ""));
  if (!columna) return fail("Esa vista no tiene foto guardada que quitar");
  const set = await cargarJuego(ctx, input?.setId);
  if (!set) return fail("Set fotográfico no encontrado");

  const fileId = (set as Record<string, unknown>)[columna];
  if (typeof fileId !== "string" || !fileId) return fail("Esa vista ya no tiene foto");
  const motivo = limpiarMotivo(input.motivo);

  try {
    await prisma.$transaction(async (tx) => {
      // Solo si sigue siendo ESA foto: si alguien la cambió entre tanto, no se pisa.
      const libre = await tx.orthoPhotoSet.updateMany({
        where: { id: set.id, clinicId: ctx.clinicId, [columna]: fileId },
        data: { [columna]: null },
      });
      if (libre.count !== 1) throw new Error("FOTO_CAMBIO");
      await tx.$executeRaw`
        INSERT INTO "ortho_photo_removals" ("id", "clinicId", "photoSetId", "slotId", "fileId", "removedById", "reason")
        VALUES (${randomUUID()}, ${ctx.clinicId}, ${set.id}, ${input.slotId}, ${fileId}, ${ctx.userId}, ${motivo})`;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "FOTO_CAMBIO") {
      return fail("Esa foto ya cambió. Recarga la pantalla y vuelve a intentarlo.");
    }
    if (faltaLaTablaDeFotos(e)) return fail(MENSAJE_SIN_TABLA_DE_FOTOS);
    console.error("[ortho] quitarFotoDeVista failed:", e);
    return fail("No se pudo quitar la foto");
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.PHOTO_REMOVED,
    entityType: "OrthoPhotoSet",
    entityId: set.id,
    meta: { slotId: input.slotId, fileId, motivo },
  });
  revalidarFicha(set.patientId);
  return ok({ setId: set.id });
}

/** Registra una foto extra ya subida (POST /api/orthodontics/photos/upload con view=extra). */
export async function agregarFotoExtra(input: {
  setId: string;
  fileId: string;
  etiqueta?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const set = await cargarJuego(ctx, input?.setId);
  if (!set) return fail("Set fotográfico no encontrado");

  // El archivo tiene que ser del MISMO paciente y clínica que el juego.
  const file =
    typeof input.fileId === "string" && input.fileId
      ? await prisma.patientFile.findFirst({
          where: { id: input.fileId, clinicId: ctx.clinicId, deletedAt: null },
          select: { clinicId: true, patientId: true },
        })
      : null;
  const ajeno = motivoArchivoAjenoAlJuego(set, file);
  if (ajeno) return fail(ajeno);

  const etiqueta = limpiarEtiqueta(input.etiqueta);
  const id = randomUUID();
  try {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "ortho_photo_extras"
      WHERE "photoSetId" = ${set.id} AND "clinicId" = ${ctx.clinicId} AND "removedAt" IS NULL`;
    if (n >= EXTRAS_MAX_POR_JUEGO) return fail(`Un juego admite hasta ${EXTRAS_MAX_POR_JUEGO} fotos extra`);
    await prisma.$executeRaw`
      INSERT INTO "ortho_photo_extras" ("id", "clinicId", "photoSetId", "fileId", "label", "createdById")
      VALUES (${id}, ${ctx.clinicId}, ${set.id}, ${input.fileId}, ${etiqueta}, ${ctx.userId})`;
  } catch (e) {
    if (faltaLaTablaDeFotos(e)) return fail(MENSAJE_SIN_TABLA_DE_FOTOS);
    console.error("[ortho] agregarFotoExtra failed:", e);
    return fail("No se pudo guardar la foto extra");
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.PHOTO_EXTRA_ADDED,
    entityType: "OrthoPhotoSet",
    entityId: set.id,
    meta: { extraId: id, fileId: input.fileId, etiqueta },
  });
  revalidarFicha(set.patientId);
  return ok({ id });
}

/** Quita una foto extra: se marca (quién, cuándo, motivo) y deja de mostrarse; no se borra. */
export async function quitarFotoExtra(input: {
  setId: string;
  extraId: string;
  motivo?: string | null;
}): Promise<ActionResult<{ setId: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const set = await cargarJuego(ctx, input?.setId);
  if (!set) return fail("Set fotográfico no encontrado");
  if (typeof input.extraId !== "string" || !input.extraId) return fail("Foto extra no encontrada");
  const motivo = limpiarMotivo(input.motivo);

  try {
    const marcadas = await prisma.$executeRaw`
      UPDATE "ortho_photo_extras"
      SET "removedAt" = now(), "removedById" = ${ctx.userId}, "removedReason" = ${motivo}
      WHERE "id" = ${input.extraId} AND "photoSetId" = ${set.id}
        AND "clinicId" = ${ctx.clinicId} AND "removedAt" IS NULL`;
    if (marcadas !== 1) return fail("Esa foto extra ya no está");
  } catch (e) {
    if (faltaLaTablaDeFotos(e)) return fail(MENSAJE_SIN_TABLA_DE_FOTOS);
    console.error("[ortho] quitarFotoExtra failed:", e);
    return fail("No se pudo quitar la foto extra");
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.PHOTO_EXTRA_REMOVED,
    entityType: "OrthoPhotoSet",
    entityId: set.id,
    meta: { extraId: input.extraId, motivo },
  });
  revalidarFicha(set.patientId);
  return ok({ setId: set.id });
}
