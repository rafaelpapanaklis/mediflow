import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import sharp from "sharp";
import { getAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { BARBER_FILES_BUCKET } from "@/lib/barber/types";
import { BARBER_SUPPORT_PREFIX } from "@/lib/barber/admin";
import {
  BARBER_SUPPORT_ALLOWED_MIME,
  BARBER_SUPPORT_MAX_FILE_BYTES,
} from "@/components/admin/barberias/shared";
import {
  verificarPdfPeligroso,
  pareceScriptOMarcado,
  tieneExtensionPeligrosa,
  limiteSubidasPorUsuario,
  registrarSubidaRechazada,
} from "@/lib/uploads/validar-archivo";

// ═══════════════════════════════════════════════════════════════════════
// /api/admin/barberias/soporte/[id]/attachments — subida de un adjunto de
// la respuesta de DaleControl. Espejo del endpoint del soporte dental, pero
// contra el bucket PRIVADO del vertical (barber-files).
//
// El barbershopId sale SIEMPRE del ticket cargado en el server, nunca del
// request: así un path no puede apuntar a la carpeta de otra barbería. La
// respuesta trae sólo metadatos ({ path, name, size, type }) — nunca una URL
// pública; el hilo firma las URLs al leerse, con TTL corto.
// ═══════════════════════════════════════════════════════════════════════

export const dynamic = "force-dynamic";

function storageAdmin() {
  return createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await getAdminSession();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!limiteSubidasPorUsuario(`admin:soporte-barberia:${admin.user.id}`)) {
      return NextResponse.json({ error: "Demasiadas subidas, espera unos minutos." }, { status: 429 });
    }

    const ticket = await prisma.barberSupportTicket.findUnique({
      where: { id: params.id },
      select: { barbershopId: true },
    });
    if (!ticket) return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file") as File | null;
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "file requerido" }, { status: 400 });
    }

    if (tieneExtensionPeligrosa(file.name)) {
      await registrarSubidaRechazada({
        ruta: "/api/admin/barberias/soporte/[id]/attachments",
        motivo: "nombre con extensión peligrosa",
        codigo: "extension_peligrosa",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: "Nombre de archivo no permitido" }, { status: 400 });
    }

    if (!(BARBER_SUPPORT_ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
    }
    if (file.size > BARBER_SUPPORT_MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Archivo demasiado grande (máx 5MB)" }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const buf = Buffer.from(bytes);

    // Texto/script disfrazado de imagen o PDF: sin firma binaria, file-type
    // no siempre lo detecta.
    const marcador = pareceScriptOMarcado(buf);
    if (marcador) {
      await registrarSubidaRechazada({
        ruta: "/api/admin/barberias/soporte/[id]/attachments",
        motivo: `contenido parece script o marcado (${marcador.trim()})`,
        codigo: "script_o_marcado",
        nombreOriginal: file.name,
      });
      return NextResponse.json({ error: "El archivo no es válido" }, { status: 400 });
    }

    // El MIME que manda el navegador es falseable: se revisan los primeros
    // bytes, igual que en el soporte del dental.
    const { validateMagicNumber } = await import("@/lib/validate-upload");
    const magicError = await validateMagicNumber(bytes, [...BARBER_SUPPORT_ALLOWED_MIME]);
    if (magicError) {
      await registrarSubidaRechazada({
        ruta: "/api/admin/barberias/soporte/[id]/attachments",
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
          ruta: "/api/admin/barberias/soporte/[id]/attachments",
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
          ruta: "/api/admin/barberias/soporte/[id]/attachments",
          motivo: "la imagen no se pudo decodificar",
          codigo: "imagen_corrupta",
          nombreOriginal: file.name,
        });
        return NextResponse.json({ error: "La imagen está corrupta o no es una imagen real" }, { status: 400 });
      }
    }

    const ext =
      (file.name.split(".").pop() ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() ||
      "bin";
    const path = `${BARBER_SUPPORT_PREFIX}/${ticket.barbershopId}/${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const { error: uploadError } = await storageAdmin()
      .storage.from(BARBER_FILES_BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[admin/barberias/attachments] error al subir:", uploadError);
      return NextResponse.json({ error: "Error al subir archivo" }, { status: 500 });
    }

    return NextResponse.json({
      path,
      name: file.name.slice(0, 120),
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    console.error("[admin/barberias/attachments] error:", err);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
