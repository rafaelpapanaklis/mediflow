// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/account-managers/[id]/photo — sube la foto del manager.
//
// Bucket: `clinic-public` (BUCKETS.CLINIC_PUBLIC), que YA existe y es público
// — no hay que crear infraestructura nueva. Es la clase de visibilidad
// correcta: un retrato que la persona acepta mostrar a los clientes, igual que
// la portada de una landing. Los archivos van bajo el prefijo
// `account-managers/<id>/` para no mezclarse con los assets de las clínicas.
//
// Validación igual que el resto de subidas del repo: MIME permitido, tamaño
// máximo y MAGIC NUMBER real (el content-type del browser es falseable).
//
// Alternativa sin subir nada: el modal de /admin también acepta pegar una URL
// de imagen (campo photoUrl del PATCH); si no hay ninguna, la tarjeta cae al
// respaldo de iniciales sobre gradiente.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { isAdminAuthed } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";
import { SQL_PENDING_MESSAGE } from "@/lib/account-manager/admin";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — es un retrato, no una radiografía.

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let exists: { id: string } | null;
  try {
    exists = await prisma.accountManager.findUnique({ where: { id: params.id }, select: { id: true } });
  } catch (e) {
    console.error("[admin/account-managers/photo] lookup:", e);
    return NextResponse.json({ error: SQL_PENDING_MESSAGE, sqlPending: true }, { status: 503 });
  }
  if (!exists) return NextResponse.json({ error: "Manager no encontrado." }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No se recibió ninguna imagen." }, { status: 400 });

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Tipo de archivo no permitido. Usa JPG, PNG o WebP." }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "La imagen supera el máximo de 5 MB." }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();

  // El MIME del browser es falseable: validamos el magic number real.
  const magicError = await validateMagicNumber(bytes, ALLOWED_TYPES);
  if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

  const ext =
    (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "jpg";
  const path = `account-managers/${params.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const supabase = getAdminSupabase();
  const { error: uploadError } = await supabase.storage
    .from(BUCKETS.CLINIC_PUBLIC)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("[admin/account-managers/photo] upload:", uploadError);
    return NextResponse.json({ error: "Error al subir la imagen." }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(path);
  if (!pub?.publicUrl) {
    return NextResponse.json({ error: "No se pudo generar la URL de la imagen." }, { status: 500 });
  }

  try {
    await prisma.accountManager.update({
      where: { id: params.id },
      data: { photoUrl: pub.publicUrl },
    });
  } catch (e) {
    console.error("[admin/account-managers/photo] update:", e);
    return NextResponse.json({ error: "No se pudo guardar la foto." }, { status: 500 });
  }

  return NextResponse.json({ photoUrl: pub.publicUrl }, { status: 201 });
}
