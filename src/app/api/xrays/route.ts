import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// GET /api/xrays?patientId=xxx
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patientId = new URL(req.url).searchParams.get("patientId");
  if (!patientId) return NextResponse.json({ error: "patientId required" }, { status: 400 });

  const files = await prisma.patientFile.findMany({
    where: { patientId, clinicId: ctx.clinicId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(files);
}

// POST /api/xrays — multipart form upload
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData   = await req.formData();
  const file       = formData.get("file") as File | null;
  const patientId  = formData.get("patientId") as string;
  const category   = (formData.get("category") as string) || "OTHER";
  const notes      = (formData.get("notes") as string) || null;
  const toothStr   = formData.get("toothNumber") as string | null;
  const toothNumber = toothStr ? parseInt(toothStr) : null;
  const takenAt    = (formData.get("takenAt") as string) || null;

  if (!file || !patientId) {
    return NextResponse.json({ error: "file y patientId requeridos" }, { status: 400 });
  }

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "image/bmp", "image/tiff"];
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Archivo demasiado grande (máx 50MB)" }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id: patientId, clinicId: ctx.clinicId },
  });
  if (!patient) return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });

  const supabase = getAdminSupabase();
  const ext  = file.name.split(".").pop() ?? "jpg";
  const path = `${ctx.clinicId}/${patientId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const bytes = await file.arrayBuffer();
  const { error: uploadError } = await supabase.storage
    .from("patient-files")
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 });
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from("patient-files")
    .createSignedUrl(path, 3600);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json({ error: "Error generando URL" }, { status: 500 });
  }

  const record = await prisma.patientFile.create({
    data: {
      patientId,
      clinicId:   ctx.clinicId,
      uploadedBy: ctx.userId,
      name:       file.name,
      url:        signedData.signedUrl,
      size:       file.size,
      mimeType:   file.type,
      category:   category as any,
      toothNumber,
      notes,
      takenAt:    takenAt ? new Date(takenAt) : null,
    },
  });

  return NextResponse.json(record, { status: 201 });
}
