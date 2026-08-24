import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getAccessibleBranchIds, getBarberContext } from "@/lib/barber-auth";
import { barberApiError, barberUnauthorized } from "@/lib/barber/branches";
import {
  BARBER_SUPPORT_ALLOWED_MIME,
  BARBER_SUPPORT_MAX_FILE_BYTES,
  supportPathPrefix,
} from "@/lib/barber/support";
import { assertBarberPermission } from "@/lib/barber-auth";
import { BARBER_FILES_BUCKET } from "@/lib/barber/types";

// POST /api/barber/support/attachments — subida multipart de UN archivo.
//
// Mismo patrón que el soporte del dental: cliente admin de Supabase,
// extensión saneada y validación por MAGIC NUMBER (el Content-Type del
// navegador es falseable). Responde solo metadatos { path, name, size, type }
// — jamás una URL: las ligas se firman al leer el hilo.
//
// La ruta va SIEMPRE particionada por barbershopId (support/{id}/...) y ese
// prefijo se vuelve a exigir al adjuntar el mensaje. Las imágenes ya llegan
// comprimidas desde el navegador (prepararImagen en el componente).

export const dynamic = "force-dynamic";

function adminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getBarberContext();
    if (!ctx) return barberUnauthorized();
    // Subir un archivo es parte de escribir en un ticket.
    assertBarberPermission(ctx, "support.manage");

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
    }

    // Sede destino: la propia, o una que la sesión ya alcance.
    let barbershopId = ctx.barbershopId;
    const requested = form?.get("branchId");
    if (typeof requested === "string" && requested) {
      const ids = await getAccessibleBranchIds(ctx);
      if (!ids.includes(requested)) {
        return NextResponse.json({ error: "Esa sede no es de tu barbería." }, { status: 404 });
      }
      barbershopId = requested;
    }

    if (!(BARBER_SUPPORT_ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return NextResponse.json(
        { error: "Solo aceptamos imágenes (JPG, PNG, WEBP, GIF) y PDF." },
        { status: 400 },
      );
    }
    if (file.size > BARBER_SUPPORT_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "El archivo pesa más de 4 MB. Recórtalo e intenta de nuevo." },
        { status: 413 },
      );
    }

    const bytes = await file.arrayBuffer();
    const { validateMagicNumber } = await import("@/lib/validate-upload");
    const magicError = await validateMagicNumber(bytes, [...BARBER_SUPPORT_ALLOWED_MIME]);
    if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

    const ext =
      (file.name.split(".").pop() ?? "bin")
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 8)
        .toLowerCase() || "bin";
    const path = `${supportPathPrefix(barbershopId)}${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const { error: uploadError } = await adminSupabase()
      .storage.from(BARBER_FILES_BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      console.error("[barber/support/attachments] upload:", uploadError);
      return NextResponse.json({ error: "No pudimos subir el archivo." }, { status: 500 });
    }

    return NextResponse.json({
      path,
      name: file.name.slice(0, 120),
      size: file.size,
      type: file.type,
    });
  } catch (err) {
    return barberApiError(err, "support/attachments:POST");
  }
}
