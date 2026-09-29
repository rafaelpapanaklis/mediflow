import { NextRequest, NextResponse } from "next/server";
import { storageQuotaError } from "@/lib/storage-quota";
import { registrarObjetoAlmacen } from "@/lib/storage-usage";
import { createClient as createAdmin } from "@supabase/supabase-js";
import sharp from "sharp";
import { getAuthContext } from "@/lib/auth-context";
import { BUCKETS } from "@/lib/storage";
import {
  SUPPORT_ALLOWED_MIME,
  SUPPORT_MAX_FILE_BYTES,
  SupportError,
} from "@/lib/support/types";
import {
  verificarPdfPeligroso,
  pareceScriptOMarcado,
  tieneExtensionPeligrosa,
  limiteSubidasPorUsuario,
  registrarSubidaRechazada,
} from "@/lib/uploads/validar-archivo";

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

    if (!limiteSubidasPorUsuario(ctx.userId)) {
      return NextResponse.json({ error: "Demasiadas subidas, espera unos minutos." }, { status: 429 });
    }

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file") as File | null;
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "file requerido" }, { status: 400 });
    }

    if (tieneExtensionPeligrosa(file.name)) {
      await registrarSubidaRechazada({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        ruta: "/api/support/attachments",
        motivo: "nombre con extensión peligrosa",
        codigo: "extension_peligrosa",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: "Nombre de archivo no permitido" }, { status: 400 });
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
    const buf = Buffer.from(bytes);

    const marcador = pareceScriptOMarcado(buf);
    if (marcador) {
      await registrarSubidaRechazada({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        ruta: "/api/support/attachments",
        motivo: `contenido parece script o marcado (${marcador.trim()})`,
        codigo: "script_o_marcado",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: "El archivo no es válido" }, { status: 400 });
    }

    // El MIME del browser es falseable: validamos los primeros bytes igual
    // que xrays (los 5 tipos permitidos tienen firma reconocible).
    const { validateMagicNumber } = await import("@/lib/validate-upload");
    const magicError = await validateMagicNumber(bytes, [...SUPPORT_ALLOWED_MIME]);
    if (magicError) {
      await registrarSubidaRechazada({
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        ruta: "/api/support/attachments",
        motivo: magicError,
        codigo: "tipo_no_permitido",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: magicError }, { status: 400 });
    }

    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(buf);

    if (detected?.mime === "application/pdf") {
      const motivoPdf = verificarPdfPeligroso(buf);
      if (motivoPdf) {
        await registrarSubidaRechazada({
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          ruta: "/api/support/attachments",
          motivo: `PDF con ${motivoPdf}`,
          codigo: "pdf_peligroso",
          nombreOriginal: file.name,
        });
        return NextResponse.json({ error: "El PDF no se puede aceptar por seguridad" }, { status: 400 });
      }
    } else if (detected?.mime.startsWith("image/") && detected.mime !== "image/gif") {
      try {
        await sharp(buf).metadata();
        await sharp(buf).toBuffer();
      } catch {
        await registrarSubidaRechazada({
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          ruta: "/api/support/attachments",
          motivo: "la imagen no se pudo decodificar",
          codigo: "imagen_corrupta",
          nombreOriginal: file.name,
        });
        return NextResponse.json({ error: "La imagen está corrupta o no es una imagen real" }, { status: 400 });
      }
    }

    const ext =
      (file.name.split(".").pop() ?? "bin")
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 8)
        .toLowerCase() || "bin";
    const path = `support/${ctx.clinicId}/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const cuotaErr = await storageQuotaError(ctx.clinicId, file.size);
    if (cuotaErr) return cuotaErr;

    const supabase = getAdminSupabase();
    const { error: uploadError } = await supabase.storage
      .from(BUCKETS.PATIENT_FILES)
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[support/attachments] Storage upload error:", uploadError);
      return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 });
    }

    await registrarObjetoAlmacen({ clinicId: ctx.clinicId, kind: "SUPPORT", bucket: BUCKETS.PATIENT_FILES, path, sizeBytes: file.size });

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
