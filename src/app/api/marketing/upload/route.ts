// Subida de imagen del Composer (WS-MKT-T3).
// POST /api/marketing/upload (multipart: file) → { url } pública de Supabase Storage.
// Reusa el bucket público existente (clinic-public) con prefijo marketing/<clinicId>/.
// Valida tipo declarado + magic number real (anti-spoof) + tamaño.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAuthContext } from "@/lib/auth-context";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";

export const dynamic = "force-dynamic";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "No se recibió ninguna imagen" }, { status: 400 });
  }
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: "Solo se permiten imágenes JPG, PNG, WEBP o GIF" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "La imagen supera el máximo de 10 MB" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  // El MIME del navegador es falseable → verifica los bytes reales.
  const magicError = await validateMagicNumber(bytes, ALLOWED);
  if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

  const ext = (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "jpg";
  // clinicId en el path = aislamiento del tenant también en Storage.
  const path = `marketing/${ctx.clinicId}/${Date.now()}_${randomUUID().slice(0, 8)}.${ext}`;

  const supabase = admin();
  const { error } = await supabase.storage
    .from(BUCKETS.CLINIC_PUBLIC)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[marketing/upload] error:", error);
    return NextResponse.json({ error: "No se pudo subir la imagen" }, { status: 500 });
  }

  const { data } = supabase.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(path);
  if (!data?.publicUrl) {
    return NextResponse.json({ error: "No se pudo generar la URL pública" }, { status: 500 });
  }
  return NextResponse.json({ url: data.publicUrl });
}
