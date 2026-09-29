// Orthodontics — upload de fotos del set fotográfico con sharp. SPEC §8.9.
// Multipart con formData: file (Blob) + setId + view.

import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { MENSAJE_SIN_ACCESO_ORTODONCIA, tieneAccesoOrtodoncia } from "@/lib/orthodontics/acceso-doctor";
import type { OrthoPhotoSetType } from "@prisma/client";
import { storageQuotaError } from "@/lib/storage-quota";
import { registrarObjetoAlmacen } from "@/lib/storage-usage";
import {
  validarArchivo,
  registrarSubidaRechazada,
  limiteSubidasPorUsuario,
} from "@/lib/uploads/validar-archivo";

import { registrarMovimientoDelPaciente } from "@/lib/movimientos-paciente/registrar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "patient-files";
// Perfil propio (no PERFILES.FOTO_CLINICA): esta ruta ya aceptaba gif/tiff/avif
// además del set clínico canónico — se conserva ese alcance, ahora validado
// por firma real + decodificación real en vez de solo el MIME declarado.
const PERFIL_FOTO_SET: import("@/lib/uploads/validar-archivo").PerfilSubida = {
  id: "ORTHO_FOTO_SET",
  mimesPermitidos: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/tiff",
    "image/avif",
    "image/heic",
    "image/heif",
  ],
  maxBytes: 25 * 1024 * 1024,
  imagen: true,
  descripcion: "foto del set fotográfico de ortodoncia",
};

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
  // Revisión cruzada (Ola 1): canAccessModule abría esta subida durante el
  // trial de cualquier clínica dental. Migrado a hasActiveOrthodonticsModule.
  const active = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!active) {
    return NextResponse.json({ error: "Módulo no activo" }, { status: 403 });
  }
  if (!tieneAccesoOrtodoncia({ role: ctx.role, permissionsOverride: ctx.permissionsOverride })) {
    return NextResponse.json({ error: MENSAJE_SIN_ACCESO_ORTODONCIA }, { status: 403 });
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
  if (file.size > PERFIL_FOTO_SET.maxBytes) {
    return NextResponse.json({ error: "Imagen demasiado grande (máx 25 MB)." }, { status: 413 });
  }

  if (!limiteSubidasPorUsuario(`dental:ortho-fotos:${ctx.userId}`)) {
    return NextResponse.json({ error: "Demasiadas subidas. Espera unos minutos." }, { status: 429 });
  }

  // Tope de almacenamiento por plan (enforcement) — antes de leer/subir bytes.
  const quotaErr = await storageQuotaError(ctx.clinicId, file.size);
  if (quotaErr) return quotaErr;

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

  // Visibilidad por paciente (barrido Ola 3): subir fotos al set de un
  // paciente restringido exige poder verlo — se resuelve vía set.patientId.
  if (set.patientId) {
    const visDenied = await assertPatientVisible(set.patientId, {
      userId: ctx.userId,
      role: ctx.role,
      clinicId: ctx.clinicId,
    });
    if (visDenied) return visDenied;
  }

  // Lee buffer + procesa con sharp.
  const arrayBuffer = await file.arrayBuffer();
  const nombreOriginal = (file as File).name ?? "foto.jpg";

  // Blindaje: valida la FIRMA real + decodificación real del contenido (no la
  // extensión ni el Content-Type) ANTES de pasar a sharp. Frena un
  // ejecutable/script/zip renombrado a .jpg y evita que sharp truene con un
  // 500 al recibir basura.
  const validado = await validarArchivo({
    bytes: arrayBuffer,
    nombreOriginal,
    perfil: PERFIL_FOTO_SET,
  });
  if (validado.ok === false) {
    await registrarSubidaRechazada({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId: set.patientId,
      ruta: "/api/orthodontics/photos/upload",
      motivo: validado.motivo,
      codigo: validado.codigo,
      nombreOriginal,
    });
    return NextResponse.json(
      { error: "Archivo no válido: el contenido no coincide con la extensión", detalle: validado.motivo },
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

  // Cada subida lleva su propio nombre (ws1-t12): una foto que se QUITA se
  // conserva en el bucket (NOM-004) y, con el path fijo por vista de antes,
  // subir otra en su lugar habría sobrescrito el archivo quitado.
  const unico = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const basePath = `${ctx.clinicId}/orthodontics/${set.patientId}/${set.id}-${safeView}-${unico}`;
  const originalPath = `${basePath}.jpg`;
  const thumbPath = `${basePath}-thumb.webp`;

  // upsert:true se conserva: el path sigue confinado al tenant (clinicId de la
  // sesión + set verificado de la clínica + safeView + sufijo propio de esta
  // subida), sin vector cross-tenant tras sanitizar view.
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

  // La miniatura no tiene columna de tamaño propia: se anota aparte (el original
  // ya cuenta por patient_files.size).
  await registrarObjetoAlmacen({ clinicId: ctx.clinicId, kind: "PHOTO_THUMB", bucket: BUCKET, path: thumbPath, sizeBytes: thumbnail.length });

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

  // La foto del juego queda en los movimientos del paciente (sin el nombre del archivo).
  await registrarMovimientoDelPaciente({
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    patientId: set.patientId,
    entityType: "patient-file",
    entityId: patientFile.id,
    action: "create",
    texto: "Subió una foto de ortodoncia a un juego de fotos",
    req,
  });

  return NextResponse.json({
    ok: true,
    fileId: patientFile.id,
    path: patientFile.url,
    thumbPath,
  });
}
