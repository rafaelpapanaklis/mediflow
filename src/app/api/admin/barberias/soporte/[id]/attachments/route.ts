import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { BARBER_FILES_BUCKET } from "@/lib/barber/types";
import { BARBER_SUPPORT_PREFIX } from "@/lib/barber/admin";
import {
  BARBER_SUPPORT_ALLOWED_MIME,
  BARBER_SUPPORT_MAX_FILE_BYTES,
} from "@/components/admin/barberias/shared";

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
    if (!(await isAdminAuthed())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    if (!(BARBER_SUPPORT_ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return NextResponse.json({ error: "Tipo de archivo no permitido" }, { status: 400 });
    }
    if (file.size > BARBER_SUPPORT_MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Archivo demasiado grande (máx 5MB)" }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();

    // El MIME que manda el navegador es falseable: se revisan los primeros
    // bytes, igual que en el soporte del dental.
    const { validateMagicNumber } = await import("@/lib/validate-upload");
    const magicError = await validateMagicNumber(bytes, [...BARBER_SUPPORT_ALLOWED_MIME]);
    if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

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
