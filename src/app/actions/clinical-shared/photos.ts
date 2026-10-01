"use server";
// Clinical-shared — server actions para ClinicalPhoto.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ClinicalModule, ClinicalPhotoStage, ClinicalPhotoType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { signMaybeUrls } from "@/lib/storage";
import { storageQuotaError } from "@/lib/storage-quota";
import { PERFILES, registrarSubidaRechazada, validarArchivo } from "@/lib/uploads/validar-archivo";
import { auditClinicalShared, guardPatient, sinPermisoClinico } from "@/lib/clinical-shared/auth/guard";
import {
  ALLOWED_PHOTO_MIME,
  MAX_PHOTO_BYTES,
  removeClinicalPhotoBinary,
  uploadClinicalPhoto,
} from "@/lib/clinical-shared/photos/storage";
import type { ClinicalPhotoDTO, PhotoAnnotation } from "@/lib/clinical-shared/photos/types";
import { fail, ok, isFailure, type ActionResult } from "@/lib/clinical-shared/result";

const moduleEnum = z.nativeEnum(ClinicalModule);
const photoTypeEnum = z.nativeEnum(ClinicalPhotoType);
const stageEnum = z.nativeEnum(ClinicalPhotoStage);

const annotationSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  label: z.string().min(1).max(120),
  color: z.string().max(20).optional(),
});

const uploadScalarsSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum,
  photoType: photoTypeEnum,
  stage: stageEnum,
  toothFdi: z.number().int().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  annotations: z.array(annotationSchema).max(20).optional(),
});

/** Sube binario + crea row ClinicalPhoto.
 *
 * Transporte: **FormData** (patrón nativo de server actions para binarios, el
 * mismo de /api/orthodontics/photos/upload). El File llega dentro del multipart
 * — a diferencia de pasar un ArrayBuffer como argumento de la action, cuya
 * serialización NO es confiable en Next 14.2 / React 18 y hacía fallar TODA
 * subida en runtime. contentType/fileName/size se derivan del propio File.
 *
 * Ficha v3: comprime con sharp (2400px jpeg q85 mozjpeg + thumbnail 300px webp
 * q80) en modo best-effort — si sharp no decodifica (ej. HEIC según plataforma)
 * sube el original y deja thumbnailUrl null. Aplica la cuota de storage del plan
 * ANTES de subir y registra sizeBytes (bytes realmente almacenados). Todo el
 * cuerpo va en try/catch: cualquier fallo se reporta con su mensaje real (+ stack
 * en logs de Vercel) en vez del error genérico. */
export async function uploadClinicalPhotoAction(
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  try {
    const file = formData.get("file");
    if (!(file instanceof Blob)) return fail("No se recibió la imagen");

    // FormData entrega strings → se normalizan antes de zod.
    const toothFdiRaw = formData.get("toothFdi");
    const notesRaw = formData.get("notes");
    const annotationsRaw = formData.get("annotations");
    let annotations: unknown = undefined;
    if (typeof annotationsRaw === "string" && annotationsRaw.length > 0) {
      try {
        annotations = JSON.parse(annotationsRaw);
      } catch {
        return fail("Anotaciones inválidas");
      }
    }
    const parsed = uploadScalarsSchema.safeParse({
      patientId: formData.get("patientId"),
      module: formData.get("module"),
      photoType: formData.get("photoType"),
      stage: formData.get("stage"),
      toothFdi:
        typeof toothFdiRaw === "string" && toothFdiRaw.length > 0 ? Number(toothFdiRaw) : null,
      notes: typeof notesRaw === "string" && notesRaw.length > 0 ? notesRaw : null,
      annotations,
    });
    if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

    // contentType/fileName/size derivados del File (ya no viajan como escalares).
    const contentType = file.type || "image/jpeg";
    const fileName = ((file as File).name || "foto.jpg").slice(0, 120);
    const size = file.size;

    if (!ALLOWED_PHOTO_MIME.has(contentType)) {
      return fail("Tipo de archivo no permitido");
    }
    if (size > MAX_PHOTO_BYTES) {
      return fail("La foto excede el tamaño máximo (25MB)");
    }

    const ctx = await getAuthContext();
    if (!ctx) return fail("No autenticado");
    // M6: permiso de rol de lo clínico (guardia compartido).
    const sinPermiso = sinPermisoClinico(ctx, "editar");
    if (sinPermiso) return sinPermiso;

    const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
    if (isFailure(guard)) return fail(guard.error);

    // Blindaje: el mismo validarArchivo de las demás subidas (/api/xrays,
    // /api/orthodontics/*): firma real del contenido, ejecutables/scripts y
    // decodificación real con sharp — una foto truncada o corrupta ya no entra
    // al expediente. El motivo llega tal cual a la pantalla.
    const rawBytes = new Uint8Array(await file.arrayBuffer());
    const validado = await validarArchivo({
      bytes: rawBytes,
      nombreOriginal: fileName,
      perfil: PERFILES.FOTO_CLINICA,
    });
    if (validado.ok === false) {
      await registrarSubidaRechazada({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        patientId: parsed.data.patientId,
        ruta: "uploadClinicalPhotoAction",
        motivo: validado.motivo,
        codigo: validado.codigo,
        nombreOriginal: fileName,
      });
      return fail(`Archivo no válido: ${validado.motivo}`);
    }

    // Cuota de almacenamiento del plan — ANTES de subir bytes. storageQuotaError
    // devuelve una NextResponse 402 (contrato de las API routes); aquí se
    // traduce al ActionResult con code PLAN_LIMIT_STORAGE para que la UI
    // muestre el CTA de plan.
    const quotaRes = await storageQuotaError(ctx.clinicId, size);
    if (quotaRes) {
      let msg = "Llegaste al límite de almacenamiento de tu plan. Libera espacio o sube de plan.";
      try {
        const body = (await quotaRes.json()) as { error?: string };
        if (body?.error) msg = body.error;
      } catch {
        /* usa el mensaje default */
      }
      return fail(msg, "PLAN_LIMIT_STORAGE");
    }

    // Compresión + thumbnail (best-effort). HEIC/HEIF pueden fallar según la
    // plataforma de sharp → se sube el original tal cual y sin thumbnail (la
    // UI cae al blobUrl).
    let mainBody: Buffer = Buffer.from(rawBytes);
    let mainContentType = contentType;
    let mainFileName = fileName;
    let thumbBody: Buffer | null = null;
    try {
      const sharp = (await import("sharp")).default;
      const compressed = await sharp(mainBody)
        .rotate()
        .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      thumbBody = await sharp(mainBody)
        .rotate()
        .resize(300, 300, { fit: "cover" })
        .webp({ quality: 80 })
        .toBuffer();
      mainBody = compressed;
      mainContentType = "image/jpeg";
      mainFileName = `${fileName.replace(/\.[^.]+$/, "")}.jpg`;
    } catch (e) {
      console.warn(
        "[clinical-photos] compresión sharp falló; se sube el original:",
        e instanceof Error ? e.message : e,
      );
      thumbBody = null;
    }

    const { storagePath } = await uploadClinicalPhoto({
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module,
      fileName: mainFileName,
      contentType: mainContentType,
      body: mainBody,
    });

    // Thumbnail best-effort: si su subida falla, la foto queda sin thumb
    // (la UI usa blobUrl) en vez de tumbar la action completa.
    let thumbPath: string | null = null;
    let thumbBytes = 0;
    if (thumbBody) {
      try {
        const thumbUpload = await uploadClinicalPhoto({
          clinicId: ctx.clinicId,
          patientId: parsed.data.patientId,
          module: parsed.data.module,
          fileName: `thumb_${mainFileName.replace(/\.[^.]+$/, "")}.webp`,
          contentType: "image/webp",
          body: thumbBody,
        });
        thumbPath = thumbUpload.storagePath;
        thumbBytes = thumbBody.length;
      } catch (e) {
        console.warn(
          "[clinical-photos] subida de thumbnail falló:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    const created = await prisma.clinicalPhoto.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        module: parsed.data.module,
        photoType: parsed.data.photoType,
        stage: parsed.data.stage,
        toothFdi: parsed.data.toothFdi ?? null,
        capturedBy: ctx.userId,
        blobUrl: storagePath,
        thumbnailUrl: thumbPath,
        // Foto + miniatura: lo que de verdad ocupa en el bucket.
        sizeBytes: mainBody.length + thumbBytes,
        notes: parsed.data.notes ?? null,
        annotations: parsed.data.annotations
          ? (parsed.data.annotations as unknown as object)
          : undefined,
      },
      select: { id: true },
    });

    await auditClinicalShared({
      ctx,
      action: "clinical-shared.photo.uploaded",
      entityType: "clinical-photo",
      entityId: created.id,
      patientId: parsed.data.patientId,
      changes: { module: parsed.data.module, photoType: parsed.data.photoType },
    });
    revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
    return ok({ id: created.id });
  } catch (e) {
    console.error(
      "[clinical-photos] uploadClinicalPhotoAction falló:",
      e instanceof Error ? e.stack : e,
    );
    return fail("Error al subir: " + (e instanceof Error ? e.message : String(e)));
  }
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function deleteClinicalPhotoAction(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  // M6: permiso de rol de lo clínico (guardia compartido).
  const sinPermiso = sinPermisoClinico(ctx, "editar");
  if (sinPermiso) return sinPermiso;
  // El rol de solo lectura puede ver la galería pero no destruir evidencia
  // clínica (el soft-delete además borra el binario del bucket).
  if (ctx.role === "READONLY") {
    return fail("Tu rol de solo lectura no permite eliminar fotos");
  }

  const photo = await prisma.clinicalPhoto.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true, blobUrl: true, thumbnailUrl: true, deletedAt: true },
  });
  if (!photo || photo.deletedAt) return fail("Foto no encontrada");
  if (photo.clinicId !== ctx.clinicId) return fail("Sin acceso a esta foto");

  await prisma.clinicalPhoto.update({
    where: { id: photo.id },
    data: { deletedAt: new Date() },
  });
  // El tamaño solo se libera si el binario de verdad salió del bucket: si el
  // borrado falla, la foto sigue ocupando y la cuenta lo refleja.
  const principalBorrada = await removeClinicalPhotoBinary(photo.blobUrl);
  const miniaturaBorrada = photo.thumbnailUrl ? await removeClinicalPhotoBinary(photo.thumbnailUrl) : true;
  if (principalBorrada && miniaturaBorrada) {
    await prisma.clinicalPhoto.update({ where: { id: photo.id }, data: { sizeBytes: 0 } });
  }

  await auditClinicalShared({
    ctx,
    action: "clinical-shared.photo.deleted",
    entityType: "clinical-photo",
    entityId: photo.id,
    patientId: photo.patientId,
  });
  revalidatePath(`/dashboard/patients/${photo.patientId}`);
  return ok({ id: photo.id });
}

const listSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum.optional(),
  photoType: photoTypeEnum.optional(),
  stage: stageEnum.optional(),
});

export async function listClinicalPhotosAction(
  input: z.infer<typeof listSchema>,
): Promise<ActionResult<ClinicalPhotoDTO[]>> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  // M6: permiso de rol de lo clínico (guardia compartido).
  const sinPermiso = sinPermisoClinico(ctx, "ver");
  if (sinPermiso) return sinPermiso;

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  const rows = await prisma.clinicalPhoto.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module ?? undefined,
      photoType: parsed.data.photoType ?? undefined,
      stage: parsed.data.stage ?? undefined,
      deletedAt: null,
    },
    orderBy: { capturedAt: "desc" },
    take: 200,
  });

  // Firma blobUrl + thumbnailUrl de TODAS las filas en UN solo round-trip
  // (createSignedUrls) en vez de hasta 2×N llamadas. Orden plano:
  // [blob0, thumb0, blob1, thumb1, ...].
  const signInputs: Array<string | null | undefined> = [];
  for (const r of rows) {
    signInputs.push(r.blobUrl);
    signInputs.push(r.thumbnailUrl);
  }
  const signedUrls = await signMaybeUrls(signInputs);
  const dtos: ClinicalPhotoDTO[] = rows.map((r, i) => ({
    id: r.id,
    patientId: r.patientId,
    module: r.module,
    toothFdi: r.toothFdi,
    photoType: r.photoType,
    stage: r.stage,
    capturedAt: r.capturedAt.toISOString(),
    capturedBy: r.capturedBy,
    blobUrl: signedUrls[i * 2],
    thumbnailUrl: r.thumbnailUrl ? signedUrls[i * 2 + 1] : null,
    notes: r.notes,
    annotations: (r.annotations as unknown as PhotoAnnotation[] | null) ?? null,
  }));

  return ok(dtos);
}

const updateAnnotationsSchema = z.object({
  id: z.string().min(1),
  annotations: z.array(annotationSchema).max(20),
});

export async function updatePhotoAnnotationsAction(
  input: z.infer<typeof updateAnnotationsSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateAnnotationsSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  // M6: permiso de rol de lo clínico (guardia compartido).
  const sinPermiso = sinPermisoClinico(ctx, "editar");
  if (sinPermiso) return sinPermiso;

  const photo = await prisma.clinicalPhoto.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true, deletedAt: true },
  });
  if (!photo || photo.deletedAt) return fail("Foto no encontrada");
  if (photo.clinicId !== ctx.clinicId) return fail("Sin acceso");

  await prisma.clinicalPhoto.update({
    where: { id: photo.id },
    data: { annotations: parsed.data.annotations as unknown as object },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.photo.annotated",
    entityType: "clinical-photo",
    entityId: photo.id,
    patientId: photo.patientId,
    changes: { count: parsed.data.annotations.length },
  });
  revalidatePath(`/dashboard/patients/${photo.patientId}`);
  return ok({ id: photo.id });
}
