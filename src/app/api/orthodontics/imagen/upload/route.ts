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
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { storageQuotaError } from "@/lib/storage-quota";
import { createSignedFileUrl } from "@/lib/storage";
import {
  validarArchivo,
  registrarSubidaRechazada,
  limiteSubidasPorUsuario,
  type PerfilSubida,
} from "@/lib/uploads/validar-archivo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "patient-files";
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/tiff"];
const PDF_MIME = "application/pdf";

const PERFIL_IMAGEN: PerfilSubida = {
  id: "ORTHO_CEFALOMETRIA_IMG",
  mimesPermitidos: IMAGE_MIMES,
  maxBytes: MAX_SIZE,
  imagen: true,
  descripcion: "radiografía o foto de análisis facial",
};
const PERFIL_PDF: PerfilSubida = {
  id: "ORTHO_TRAZADO_PDF",
  mimesPermitidos: [PDF_MIME],
  maxBytes: MAX_SIZE,
  pdfProfundo: true,
  descripcion: "PDF de trazado cefalométrico",
};

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (ctx.clinicCategory !== "DENTAL") {
    return NextResponse.json({ error: "Categoría no válida" }, { status: 403 });
  }
  // Revisión cruzada (Ola 1): canAccessModule abre este endpoint durante el
  // trial de cualquier clínica dental. Migrado a hasActiveOrthodonticsModule.
  const active = await hasActiveOrthodonticsModule(ctx.clinicId);
  if (!active) {
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

  if (!limiteSubidasPorUsuario(`dental:ortho-imagen:${ctx.userId}`)) {
    return NextResponse.json({ error: "Demasiadas subidas. Espera unos minutos." }, { status: 429 });
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
  const nombreOriginal = (file as File).name ?? (kind === "tracing-pdf" ? "trazado.pdf" : "imagen.jpg");
  const validado = await validarArchivo({
    bytes: arrayBuffer,
    nombreOriginal,
    perfil: kind === "tracing-pdf" ? PERFIL_PDF : PERFIL_IMAGEN,
  });
  if (validado.ok === false) {
    await registrarSubidaRechazada({
      clinicId: ctx.clinicId,
      userId: ctx.userId,
      patientId,
      ruta: "/api/orthodontics/imagen/upload",
      motivo: validado.motivo,
      codigo: validado.codigo,
      nombreOriginal,
    });
    return NextResponse.json(
      { error: "Archivo no válido: el contenido no coincide con la extensión", detalle: validado.motivo },
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

  // El bucket es privado: `path` no sirve como <img src>. Se firma AQUÍ,
  // en la propia respuesta de subida, para que el cliente pueda mostrar la
  // imagen de inmediato sin un segundo viaje ni una ruta que "resuelva" un
  // fileId a una URL (hallazgo ws1-t11: los dos componentes que consumen
  // esto fabricaban `/api/files/<id>`, una ruta que nunca existió — 404 en
  // dev.108). Falla en SUAVE: si firmar falla, el archivo YA se subió y
  // tiene fileId; `signedUrl: null` dice "sin vista previa todavía", nunca
  // rompe la subida que sí funcionó.
  let signedUrl: string | null = null;
  try {
    signedUrl = await createSignedFileUrl(patientFile.url);
  } catch (e) {
    console.error("[ortho imagen upload] no se pudo firmar la URL de vista previa:", e);
  }

  return NextResponse.json({ ok: true, fileId: patientFile.id, path: patientFile.url, signedUrl });
}
