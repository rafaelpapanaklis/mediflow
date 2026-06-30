import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { BUCKETS, signMaybeUrl, signMaybeUrls } from "@/lib/storage";
import { storageQuotaError } from "@/lib/storage-quota";

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

  // Los modelos 3D (SCAN_STL + mallas/DICOM por extensión) viven SOLO en la
  // pestaña "Modelos 3D" (GET /api/patients/[id]/models-3d). Excluimos aquí el
  // ESPEJO EXACTO de ese filtro para que un archivo nunca aparezca en ambas
  // vistas: /api/xrays devuelve justo el complemento. Una sola fuente de verdad.
  // (No toca la subida ni el aislamiento por clinicId.)
  const files = await prisma.patientFile.findMany({
    where: {
      patientId,
      clinicId: ctx.clinicId,
      deletedAt: null, // NOM-024 §7 — oculta radiografías borradas lógicamente
      NOT: {
        OR: [
          { category: "SCAN_STL" as any },
          { name: { endsWith: ".stl" } },
          { name: { endsWith: ".ply" } },
          { name: { endsWith: ".obj" } },
          { name: { endsWith: ".dcm" } },
          { name: { endsWith: ".dicom" } },
        ],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Firma cada URL on-demand (TTL 5 min). Acepta tanto paths nuevos como
  // URLs legacy guardadas antes de la migración a bucket privado.
  // Firma todas las URLs en UN round-trip (createSignedUrls) en vez de N×.
  const urls = await signMaybeUrls(files.map((f) => f.url));
  const signed = files.map((f, i) => ({ ...f, url: urls[i] }));

  return NextResponse.json(signed);
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

  // Tope de almacenamiento por plan (enforcement) — antes de subir al bucket.
  const quotaErr = await storageQuotaError(ctx.clinicId, file.size);
  if (quotaErr) return quotaErr;

  const supabase = getAdminSupabase();
  const ext  = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "jpg";
  const path = `${ctx.clinicId}/${patientId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const bytes = await file.arrayBuffer();

  const { validateMagicNumber } = await import("@/lib/validate-upload");
  const magicError = await validateMagicNumber(bytes, ALLOWED_TYPES);
  if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

  const { error: uploadError } = await supabase.storage
    .from(BUCKETS.PATIENT_FILES)
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 });
  }

  // Persistimos SOLO el path interno del bucket (no la URL completa). La
  // signed URL se genera bajo demanda en cada request de lectura.
  const record = await prisma.patientFile.create({
    data: {
      patientId,
      clinicId:   ctx.clinicId,
      uploadedBy: ctx.userId,
      name:       file.name,
      url:        path,
      size:       file.size,
      mimeType:   file.type,
      category:   category as any,
      toothNumber,
      notes,
      takenAt:    takenAt ? new Date(takenAt) : null,
    },
  });

  // Devolvemos al cliente la URL ya firmada para que pueda mostrar el
  // archivo de inmediato sin un GET extra.
  const signedUrl = await signMaybeUrl(path).catch(() => "");
  return NextResponse.json({ ...record, url: signedUrl }, { status: 201 });
}
