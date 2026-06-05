import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS, signMaybeUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mallas (stl/ply/obj) + tomografías DICOM (dcm/dicom). DICOM no se renderiza
// como malla todavía: se almacena, valida y permite descargar.
const ALLOWED_EXT = ["stl", "ply", "obj", "dcm", "dicom"] as const;
const MAX_SIZE = 100 * 1024 * 1024; // 100 MB

function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

function mimeForExt(ext: string, fallback: string): string {
  switch (ext) {
    case "stl":
      return "model/stl";
    case "obj":
      return "model/obj";
    case "dcm":
    case "dicom":
      return "application/dicom";
    case "ply":
    default:
      return fallback || "application/octet-stream";
  }
}

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// GET /api/patients/[id]/models-3d — lista los modelos 3D del paciente con
// signed URL fresca por archivo. Multi-tenant: clinicId SIEMPRE de la sesión.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const files = await prisma.patientFile.findMany({
    where: {
      patientId: params.id,
      clinicId: ctx.clinicId,
      OR: [
        { category: "SCAN_STL" as any },
        { name: { endsWith: ".stl" } },
        { name: { endsWith: ".ply" } },
        { name: { endsWith: ".obj" } },
        { name: { endsWith: ".dcm" } },
        { name: { endsWith: ".dicom" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      url: true,
      size: true,
      mimeType: true,
      createdAt: true,
      doctorNotes: true,
      annotations: true,
    },
  });

  const signed = await Promise.all(
    files.map(async (f) => ({ ...f, url: await signMaybeUrl(f.url).catch(() => "") })),
  );
  return NextResponse.json(signed);
}

// POST /api/patients/[id]/models-3d — sube un modelo 3D (STL/PLY/OBJ) o una
// tomografía DICOM (.dcm/.dicom) tal cual (sin sharp). Valida extensión y
// tamaño. Crea un PatientFile con category SCAN_STL.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const patient = await prisma.patient.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Storage no configurado" }, { status: 500 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
  }
  const originalName = ((file as File).name || "modelo").trim();
  const ext = extOf(originalName);
  if (!ALLOWED_EXT.includes(ext as (typeof ALLOWED_EXT)[number])) {
    return NextResponse.json(
      { error: "Formato no permitido. Solo STL, PLY, OBJ o DICOM (.dcm)." },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Archivo demasiado grande (máx 100 MB)." }, { status: 413 });
  }

  // Nombre seguro para el path del bucket (conserva la extensión real).
  const safeName =
    originalName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_{2,}/g, "_").slice(-80) ||
    `modelo.${ext}`;
  const path = `${ctx.clinicId}/models-3d/${params.id}/${randomUUID()}-${safeName}`;
  const contentType = mimeForExt(ext, (file as File).type);

  const bytes = await file.arrayBuffer();
  const supabase = getAdminSupabase();
  const { error: uploadError } = await supabase.storage
    .from(BUCKETS.PATIENT_FILES)
    .upload(path, bytes, { contentType, upsert: false });
  if (uploadError) {
    console.error("[models-3d] storage upload error:", uploadError);
    return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
  }

  // Persistimos SOLO el path interno; la signed URL se genera bajo demanda.
  const record = await prisma.patientFile.create({
    data: {
      patientId: params.id,
      clinicId: ctx.clinicId,
      uploadedBy: ctx.userId,
      name: originalName,
      url: path,
      size: file.size,
      mimeType: contentType,
      category: "SCAN_STL" as any,
    },
    select: { id: true, name: true, url: true, size: true, mimeType: true, createdAt: true },
  });

  const signedUrl = await signMaybeUrl(record.url).catch(() => "");
  return NextResponse.json({ ...record, url: signedUrl }, { status: 201 });
}
