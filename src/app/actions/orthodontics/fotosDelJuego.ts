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
  MENSAJE_SIN_COLUMNA_DE_VISTA,
  MENSAJE_SIN_TABLA_DE_FOTOS,
  columnaDeVista,
  esVistaEnExtras,
  faltaLaColumnaDeFotos,
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

  const slotId = String(input?.slotId ?? "");
  const columna = columnaDeVista(slotId);
  if (!columna && !esVistaEnExtras(slotId)) return fail("Esa vista no tiene foto guardada que quitar");
  const set = await cargarJuego(ctx, input?.setId);
  if (!set) return fail("Set fotográfico no encontrado");

  // Sobremordida y resalte: su foto es una fila de `ortho_photo_extras` con
  // `slotId`. Se MARCA como quitada (quién, cuándo, motivo), igual que una extra.
  if (!columna) {
    const motivoVista = limpiarMotivo(input.motivo);
    try {
      const marcadas = await prisma.$executeRaw`
        UPDATE "ortho_photo_extras"
        SET "removedAt" = now(), "removedById" = ${ctx.userId}, "removedReason" = ${motivoVista}
        WHERE "photoSetId" = ${set.id} AND "clinicId" = ${ctx.clinicId}
          AND "slotId" = ${slotId} AND "removedAt" IS NULL`;
      if (marcadas < 1) return fail("Esa vista ya no tiene foto");
    } catch (e) {
      if (faltaLaColumnaDeFotos(e)) return fail(MENSAJE_SIN_COLUMNA_DE_VISTA);
      if (faltaLaTablaDeFotos(e)) return fail(MENSAJE_SIN_TABLA_DE_FOTOS);
      console.error("[ortho] quitarFotoDeVista (extras) failed:", e);
      return fail("No se pudo quitar la foto");
    }
    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.PHOTO_REMOVED,
      entityType: "OrthoPhotoSet",
      entityId: set.id,
      patientId: set.patientId,
      meta: { slotId, motivo: motivoVista },
    });
    revalidarFicha(set.patientId);
    return ok({ setId: set.id });
  }

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
    patientId: set.patientId,
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
  /** «sobremordida» o «resalte»: la foto de esa vista (no una extra suelta). */
  slot?: string | null;
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

  const slot = input.slot == null || input.slot === "" ? null : String(input.slot);
  if (slot !== null && !esVistaEnExtras(slot)) return fail("Esa vista no se guarda como foto extra");
  const etiqueta = limpiarEtiqueta(input.etiqueta);
  const id = randomUUID();
  try {
    if (slot) {
      // Una sola foto vigente por vista: para cambiarla primero se quita.
      const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "ortho_photo_extras"
        WHERE "photoSetId" = ${set.id} AND "clinicId" = ${ctx.clinicId}
          AND "slotId" = ${slot} AND "removedAt" IS NULL`;
      if (n > 0) return fail("Esa vista ya tiene foto: quítala primero para subir otra");
      await prisma.$executeRaw`
        INSERT INTO "ortho_photo_extras" ("id", "clinicId", "photoSetId", "fileId", "label", "slotId", "createdById")
        VALUES (${id}, ${ctx.clinicId}, ${set.id}, ${input.fileId}, ${null}, ${slot}, ${ctx.userId})`;
    } else {
      const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "ortho_photo_extras"
        WHERE "photoSetId" = ${set.id} AND "clinicId" = ${ctx.clinicId} AND "removedAt" IS NULL`;
      if (n >= EXTRAS_MAX_POR_JUEGO) return fail(`Un juego admite hasta ${EXTRAS_MAX_POR_JUEGO} fotos extra`);
      await prisma.$executeRaw`
        INSERT INTO "ortho_photo_extras" ("id", "clinicId", "photoSetId", "fileId", "label", "createdById")
        VALUES (${id}, ${ctx.clinicId}, ${set.id}, ${input.fileId}, ${etiqueta}, ${ctx.userId})`;
    }
  } catch (e) {
    if (slot && faltaLaColumnaDeFotos(e)) return fail(MENSAJE_SIN_COLUMNA_DE_VISTA);
    if (faltaLaTablaDeFotos(e)) return fail(MENSAJE_SIN_TABLA_DE_FOTOS);
    // Índice único (dos subidas a la vez a la misma vista): la segunda pierde.
    if (slot && (e as { code?: string })?.code === "P2010" && /23505|unique/i.test(String((e as { message?: string }).message))) {
      return fail("Esa vista ya tiene foto: quítala primero para subir otra");
    }
    console.error("[ortho] agregarFotoExtra failed:", e);
    return fail("No se pudo guardar la foto extra");
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.PHOTO_EXTRA_ADDED,
    entityType: "OrthoPhotoSet",
    entityId: set.id,
    patientId: set.patientId,
    meta: { extraId: id, fileId: input.fileId, etiqueta, slotId: slot },
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
    patientId: set.patientId,
    meta: { extraId: input.extraId, motivo },
  });
  revalidarFicha(set.patientId);
  return ok({ setId: set.id });
}
