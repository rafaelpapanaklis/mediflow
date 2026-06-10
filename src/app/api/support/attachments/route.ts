import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getAuthContext } from "@/lib/auth-context";
import { BUCKETS } from "@/lib/storage";
import {
  SUPPORT_ALLOWED_MIME,
  SUPPORT_MAX_FILE_BYTES,
  SupportError,
} from "@/lib/support/types";

// ═══════════════════════════════════════════════════════════════════════════
// /api/support/attachments — upload multipart de adjuntos (lado CLÍNICA).
// Patrón de src/app/api/xrays/route.ts: cliente admin de Supabase + extensión
// sanitizada + magic number. Sube al bucket privado BUCKETS.PATIENT_FILES bajo
// `support/{ctx.clinicId}/...` (prefijo OBLIGATORIO: el service lo valida al
// adjuntar) y responde { path, name, size, type } — NUNCA URL pública; las
// signed URLs se generan al leer el hilo.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getAuthContext();
    if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file") as File | null;
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "file requerido" }, { status: 400 });
    }

    if (!(SUPPORT_ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
    }
    if (file.size > SUPPORT_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "Archivo demasiado grande (máx 5MB)" },
        { status: 413 }
      );
    }

    const bytes = await file.arrayBuffer();

    // El MIME del browser es falseable: validamos los primeros bytes igual
    // que xrays (los 5 tipos permitidos tienen firma reconocible).
    const { validateMagicNumber } = await import("@/lib/validate-upload");
    const magicError = await validateMagicNumber(bytes, [...SUPPORT_ALLOWED_MIME]);
    if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

    const ext =
      (file.name.split(".").pop() ?? "bin")
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 8)
        .toLowerCase() || "bin";
    const path = `support/${ctx.clinicId}/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const supabase = getAdminSupabase();
    const { error: uploadError } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[support/attachments] Storage upload error:", uploadError);
      return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 });
    }

    // Solo metadatos (path interno del bucket). El cliente los manda después
    // a POST /api/support/tickets(/[id]/messages) y el service los re-valida.
    return NextResponse.json({
      path,
      name: file.name.slice(0, 120),
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    if (err instanceof SupportError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[support/attachments] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
