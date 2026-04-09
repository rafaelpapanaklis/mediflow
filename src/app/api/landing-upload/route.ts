import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { createClient as createAdmin } from "@supabase/supabase-js";

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file     = formData.get("file") as File | null;
  const field    = formData.get("field") as string | null; // "cover" | "gallery"

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const ext  = file.name.split(".").pop() ?? "jpg";
  const path = `landing/${ctx.clinicId}/${field}/${Date.now()}.${ext}`;

  const supabase = getAdminSupabase();
  const bytes    = await file.arrayBuffer();

  const { error } = await supabase.storage
    .from("patient-files")
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Error al subir imagen" }, { status: 500 });
  }

  const { data: { publicUrl } } = supabase.storage.from("patient-files").getPublicUrl(path);
  return NextResponse.json({ url: publicUrl });
}
