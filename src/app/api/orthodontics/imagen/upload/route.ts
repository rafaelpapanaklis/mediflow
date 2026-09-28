// POST /api/orthodontics/imagen/upload — Parte 7 «Imagen y análisis»
// (ws1-t8, ola 1, sep-2026). Sube la radiografía lateral de cráneo (H1) o
// el PDF de trazado del centro radiológico (A9/H1), y crea el PatientFile
// correspondiente. Mismo patrón que /api/orthodontics/photos/upload.

import { NextResponse, type NextRequest } from "next/server";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { validateMagicNumber } from "@/lib/validate-upload";
import { canAccessModule } from "@/lib/marketplace/access-control";
import { ORTHODONTICS_MODULE_KEY } from "@/lib/specialties/keys";
import { storageQuotaError } from "@/lib/storage-quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "patient-files";
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/tiff"];
const PDF_MIME = "application/pdf";

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
    return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const patientId = form.get("patientId");
  const kindRaw = form.get("kind"); // "xray" | "tracing-pdf" | "facial-perfil" | "facial-frente"

  if (!(file instanceof Blob) || typeof patientId !== "string" || typeof kindRaw !== "string") {
    return NextResponse.json({ error: "file + patientId + kind requeridos" }, { status: 400 });
  }
  const kind =
    kindRaw === "tracing-pdf" || kindRaw === "facial-perfil" || kindRaw === "facial-frente" ? kindRaw : "xray";

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Archivo demasiado grande (máx 25 MB)." }, { status: 413 });
  }

  const quotaErr = await storageQuotaError(ctx.clinicId, file.size);
  if (quotaErr) return quotaErr;

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const visDenied = await assertPatientVisible(patientId, {
    userId: ctx.userId,
    role: ctx.role,
    clinicId: ctx.clinicId,
  });
  if (visDenied) return visDenied;

  const arrayBuffer = await file.arrayBuffer();
  const allowedMimes = kind === "tracing-pdf" ? [PDF_MIME] : IMAGE_MIMES;
  const magicError = await validateMagicNumber(arrayBuffer, allowedMimes);
  if (magicError) {
    return NextResponse.json(
      { error: "Archivo no válido: el contenido no coincide con la extensión", detalle: magicError },
      { status: 400 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const basePath = `${ctx.clinicId}/orthodontics/${patientId}/cefalometria-${Date.now()}`;

  let uploadBuffer: Buffer;
  let contentType: string;
  let ext: string;
  let category: "XRAY_CEPHALOMETRIC" | "CEPH_ANALYSIS_PDF" | "PHOTO_LATERAL" | "PHOTO_FRONTAL";

  if (kind === "tracing-pdf") {
    uploadBuffer = Buffer.from(arrayBuffer);
    contentType = PDF_MIME;
    ext = "pdf";
    category = "CEPH_ANALYSIS_PDF";
  } else {
    uploadBuffer = await sharp(Buffer.from(arrayBuffer))
      .rotate()
      .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    contentType = "image/jpeg";
    ext = "jpg";
    category = kind === "facial-perfil" ? "PHOTO_LATERAL" : kind === "facial-frente" ? "PHOTO_FRONTAL" : "XRAY_CEPHALOMETRIC";
  }

  const path = `${basePath}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, uploadBuffer, {
    contentType,
    upsert: false,
  });
  if (uploadError) {
    console.error("[ortho imagen upload] storage failed", uploadError);
    return NextResponse.json({ error: "Falló subida a storage" }, { status: 500 });
  }

  const patientFile = await prisma.patientFile.create({
    data: {
      clinicId: ctx.clinicId,
      patientId,
      uploadedBy: ctx.userId,
      name:
        kind === "tracing-pdf"
          ? "Trazado cefalométrico.pdf"
          : kind === "facial-perfil"
            ? "Foto de perfil (análisis facial).jpg"
            : kind === "facial-frente"
              ? "Foto de frente (análisis facial).jpg"
              : "Radiografía lateral de cráneo.jpg",
      url: path,
      size: uploadBuffer.length,
      mimeType: contentType,
      category,
    },
    select: { id: true, url: true },
  });

  return NextResponse.json({ ok: true, fileId: patientFile.id, path: patientFile.url });
}
