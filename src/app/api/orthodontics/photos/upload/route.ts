// Orthodontics — upload de fotos del set fotográfico con sharp. SPEC §8.9.
// Multipart con formData: file (Blob) + setId + view.

import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { validateMagicNumber } from "@/lib/validate-upload";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import type { OrthoPhotoSetType } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "patient-files";
const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25 MB — holgado para una foto de cámara/celular.
const IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/avif",
  "image/heic",
  "image/heif",
];

function fileCategoryFromSetType(setType: OrthoPhotoSetType) {
  switch (setType) {
    case "T0":
      return "ORTHO_PHOTO_T0";
    case "T1":
      return "ORTHO_PHOTO_T1";
    case "T2":
      return "ORTHO_PHOTO_T2";
    case "CONTROL":
    default:
      return "ORTHO_PHOTO_CONTROL";
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ error: "Categoría no válida" }, { status: 403 });
  }
  const access = await canAccessModule(ctx.clinicId, ORTHODONTICS_MODULE_KEY);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Módulo no activo" }, { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Storage no configurado" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const setId = form.get("setId");
  const view = form.get("view");
  if (!(file instanceof Blob) || typeof setId !== "string" || typeof view !== "string") {
    return NextResponse.json(
      { error: "file + setId + view requeridos" },
      { status: 400 },
    );
  }

  // Tope de tamaño ANTES de cargar bytes en memoria / pasar a sharp.
  if (file.size > MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: "Imagen demasiado grande (máx 25 MB)." }, { status: 413 });
  }

  // Seguridad: `view` viene del cliente y se interpola en el path del bucket. Sin
  // sanitizar, un valor como "../<otra-clinica>/..." escaparía la carpeta de la
  // clínica (path traversal cross-tenant). Lo restringimos a un slug seguro; los
  // valores legítimos (enum OrthoPhotoView) ya son ASCII, así que no se alteran.
  const safeView = String(view ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (!safeView) {
    return NextResponse.json({ error: "view inválido" }, { status: 400 });
  }

  const set = await prisma.orthoPhotoSet.findFirst({
    where: { id: setId, clinicId: ctx.clinicId },
    select: { id: true, patientId: true, setType: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set no encontrado" }, { status: 404 });
  }

  // Lee buffer + procesa con sharp.
  const arrayBuffer = await file.arrayBuffer();

  // Blindaje: valida la FIRMA real del contenido (no la extensión) ANTES de
  // pasar a sharp. Frena un ejecutable/zip renombrado a .jpg y evita que sharp
  // truene con un 500 al recibir basura.
  const magicError = await validateMagicNumber(arrayBuffer, IMAGE_MIMES);
  if (magicError) {
    return NextResponse.json(
      { error: "Archivo no válido: el contenido no coincide con la extensión", detalle: magicError },
      { status: 400 },
    );
  }

  const inputBuffer = Buffer.from(arrayBuffer);

  const original = await sharp(inputBuffer)
    .rotate()
    .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const thumbnail = await sharp(inputBuffer)
    .rotate()
    .resize(300, 300, { fit: "cover" })
    .webp({ quality: 80 })
    .toBuffer();

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const basePath = `${ctx.clinicId}/orthodontics/${set.patientId}/${set.id}-${safeView}`;
  const originalPath = `${basePath}.jpg`;
  const thumbPath = `${basePath}-thumb.webp`;

  // upsert:true intencional: el path queda confinado al tenant (clinicId de la
  // sesión + set verificado de la clínica + safeView), así que solo puede
  // sobrescribir la propia foto de esta vista. Es lo que requiere reintentar o
  // retomar una vista del set; ya no hay vector cross-tenant tras sanitizar view.
  const [originalUpload, thumbUpload] = await Promise.all([
    supabase.storage.from(BUCKET).upload(originalPath, original, {
      contentType: "image/jpeg",
      upsert: true,
    }),
    supabase.storage.from(BUCKET).upload(thumbPath, thumbnail, {
      contentType: "image/webp",
      upsert: true,
    }),
  ]);
  if (originalUpload.error || thumbUpload.error) {
    console.error("[ortho upload] storage failed", originalUpload.error, thumbUpload.error);
    return NextResponse.json(
      { error: "Falló subida a storage" },
      { status: 500 },
    );
  }

  // Crea PatientFile referenciando el path original.
  const patientFile = await prisma.patientFile.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: set.patientId,
      uploadedBy: ctx.userId,
      name: `${safeView}.jpg`,
      url: originalPath,
      size: original.length,
      mimeType: "image/jpeg",
      category: fileCategoryFromSetType(set.setType),
      notes: `Set ${set.setType} · vista ${safeView}`,
    },
    select: { id: true, url: true },
  });

  return NextResponse.json({
    ok: true,
    fileId: patientFile.id,
    path: patientFile.url,
    thumbPath,
  });
}
