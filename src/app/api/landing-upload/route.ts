import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Las imágenes de la landing pública de cada clínica viven en un bucket
// PÚBLICO separado (CLINIC_PUBLIC). El bucket clínico (PATIENT_FILES) está
// privado y sólo se accede con signed URLs de TTL corto.
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file     = formData.get("file") as File | null;
  const field    = formData.get("field") as string | null; // "cover" | "gallery"

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "image/bmp", "image/tiff"];
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Archivo demasiado grande (máx 50MB)" }, { status: 400 });
  }

  const ext  = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "jpg";
  const path = `landing/${ctx.clinicId}/${field}/${Date.now()}.${ext}`;

  const supabase = getAdminSupabase();
  const bytes    = await file.arrayBuffer();

  const magicError = await validateMagicNumber(bytes, ALLOWED_TYPES);
  if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

  const { error } = await supabase.storage
    .from(BUCKETS.CLINIC_PUBLIC)
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Error al subir imagen" }, { status: 500 });
  }

  // Public URL — la landing es pública e indexable, no usa signed URLs.
  const { data: publicData } = supabase.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(path);
  if (!publicData?.publicUrl) {
    return NextResponse.json({ error: "Error generando URL" }, { status: 500 });
  }
  return NextResponse.json({ url: publicData.publicUrl });
}
