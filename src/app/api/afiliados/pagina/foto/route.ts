/**
 * Foto de perfil de la página del socio.
 *   POST   /api/afiliados/pagina/foto → sube y la deja en el BORRADOR
 *   DELETE /api/afiliados/pagina/foto → la quita del BORRADOR
 *
 * Mismo patrón de subida que /api/admin/account-managers/[id]/photo: bucket
 * `clinic-public` (ya existe y es público, la clase de visibilidad correcta
 * para un retrato que la persona acepta enseñar), MIME permitido, tope de
 * tamaño y MAGIC NUMBER real — el content-type del navegador es falseable.
 * Los archivos van bajo `affiliates/<id>/` para no mezclarse con los assets de
 * las clínicas ni con los de los managers.
 *
 * Lo que se guarda NO es lo que llegó. sharp recorta la imagen a un cuadrado
 * centrado y la baja a 512px webp por tres razones:
 *   · el recorte cuadrado es el que promete la pantalla, y la vista previa
 *     tiene que enseñar exactamente lo que se va a publicar;
 *   · esta foto acaba en una landing pública, y 5 MB de cámara ahí dentro
 *     arruinan el LCP de la página de un socio que no tiene por qué saber de
 *     compresión;
 *   · reencodear tira los EXIF, y un retrato de teléfono suele traer las
 *     coordenadas de dónde se tomó.
 *
 * La foto entra directo al borrador (photoUrlPending): no se publica hasta
 * que Rafael aprueba, como el texto.
 */
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { getAffiliateContext } from "@/lib/affiliate-auth";
import { validateMagicNumber } from "@/lib/validate-upload";
import { BUCKETS } from "@/lib/storage";
import { buildDraftPatch, canEditPage } from "@/lib/affiliates/page-config";
import { PARTNER_PAGE_SELECT, loadPartnerPage, toPageState } from "@/lib/affiliates/page-store";

// sharp es nativo: exige el runtime de Node, no el edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB — es un retrato, no una radiografía.
/** 512 basta: se pinta a ~128px y cubre pantallas de 2x y 3x sin pesar. */
const PHOTO_SIZE = 512;

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Ruta dentro del bucket a partir de la URL pública, y SOLO si el archivo
 * cuelga de la carpeta de este afiliado. Devuelve null para cualquier otra
 * cosa —una URL pegada a mano, la foto de otro, un dominio ajeno— para que el
 * borrado de la foto anterior no pueda alcanzar nada que no sea suyo.
 */
function ownedStoragePath(url: string | null, affiliateId: string): string | null {
  if (!url) return null;
  const marker = `/${BUCKETS.CLINIC_PUBLIC}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length).split("?")[0];
  return path.startsWith(`affiliates/${affiliateId}/`) ? path : null;
}

/**
 * Borra la foto que el borrador tenía antes. Best-effort: si falla, se queda
 * un archivo huérfano en el bucket y ya — nunca vale tumbar la subida buena.
 * Jamás toca la foto PUBLICADA: esa sigue viva en /socio/<slug>.
 */
async function removeStaleDraftPhoto(opts: {
  previous: string | null;
  published: string | null;
  affiliateId: string;
}) {
  const { previous, published, affiliateId } = opts;
  if (!previous || previous === published) return;
  const path = ownedStoragePath(previous, affiliateId);
  if (!path) return;
  try {
    await getAdminSupabase().storage.from(BUCKETS.CLINIC_PUBLIC).remove([path]);
  } catch (e) {
    console.warn("[afiliados/pagina/foto] no se pudo borrar la foto anterior:", e);
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const row = await loadPartnerPage(ctx.affiliateId);
  if (!row) return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });
  if (!canEditPage(row.pageStatus)) {
    return NextResponse.json(
      { error: "Tu página está en revisión. Espera el resultado para cambiar tu foto." },
      { status: 409 },
    );
  }

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

  // El MIME del navegador es falseable: se valida la firma real ANTES de
  // pasarle nada a sharp, que además reventaría con un 500 ante basura.
  const magicError = await validateMagicNumber(bytes, ALLOWED_TYPES);
  if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

  let processed: Buffer;
  try {
    processed = await sharp(Buffer.from(bytes))
      // .rotate() sin argumentos aplica la orientación EXIF. Sin esto, una
      // foto vertical de teléfono se publica acostada.
      .rotate()
      // "centre", no "attention": el recorte tiene que ser PREDECIBLE, porque
      // la vista previa del panel enseña ese mismo encuadre. Un recorte
      // "inteligente" que elige otra región dejaría mentir a la vista previa.
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (e) {
    console.error("[afiliados/pagina/foto] sharp:", e);
    return NextResponse.json({ error: "No se pudo procesar la imagen." }, { status: 400 });
  }

  const path = `affiliates/${ctx.affiliateId}/${Date.now()}_${Math.random().toString(36).slice(2)}.webp`;

  const supabase = getAdminSupabase();
  const { error: uploadError } = await supabase.storage
    .from(BUCKETS.CLINIC_PUBLIC)
    .upload(path, processed, { contentType: "image/webp", upsert: false });
  if (uploadError) {
    console.error("[afiliados/pagina/foto] upload:", uploadError);
    return NextResponse.json({ error: "Error al subir la imagen." }, { status: 500 });
  }

  const { data: pub } = supabase.storage.from(BUCKETS.CLINIC_PUBLIC).getPublicUrl(path);
  if (!pub?.publicUrl) {
    return NextResponse.json({ error: "No se pudo generar la URL de la imagen." }, { status: 500 });
  }

  const previous = row.photoUrlPending;
  const patch = buildDraftPatch(row, { photoUrl: pub.publicUrl });

  let updated;
  try {
    updated = await prisma.affiliate.update({
      where: { id: ctx.affiliateId },
      data: {
        photoUrlPending: patch.photoUrlPending,
        bioPending: patch.bioPending,
        sectionsConfigPending: patch.sectionsConfigPending as any,
        ...(patch.pageStatus ? { pageStatus: patch.pageStatus } : {}),
      },
      select: PARTNER_PAGE_SELECT,
    });
  } catch (e) {
    console.error("[afiliados/pagina/foto] update:", e);
    // El archivo ya subió pero la fila no apunta a él: se limpia para no
    // dejar basura en un bucket público.
    try {
      await supabase.storage.from(BUCKETS.CLINIC_PUBLIC).remove([path]);
    } catch {}
    return NextResponse.json({ error: "No se pudo guardar la foto." }, { status: 500 });
  }

  await removeStaleDraftPhoto({ previous, published: row.photoUrl, affiliateId: ctx.affiliateId });

  return NextResponse.json(toPageState(updated), { status: 201 });
}

export async function DELETE() {
  const ctx = await getAffiliateContext();
  if (!ctx || ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const row = await loadPartnerPage(ctx.affiliateId);
  if (!row) return NextResponse.json({ error: "Afiliado no encontrado" }, { status: 404 });
  if (!canEditPage(row.pageStatus)) {
    return NextResponse.json(
      { error: "Tu página está en revisión. Espera el resultado para cambiar tu foto." },
      { status: 409 },
    );
  }

  const previous = row.photoUrlPending;
  const patch = buildDraftPatch(row, { photoUrl: null });

  const updated = await prisma.affiliate.update({
    where: { id: ctx.affiliateId },
    data: {
      photoUrlPending: patch.photoUrlPending,
      bioPending: patch.bioPending,
      sectionsConfigPending: patch.sectionsConfigPending as any,
      ...(patch.pageStatus ? { pageStatus: patch.pageStatus } : {}),
    },
    select: PARTNER_PAGE_SELECT,
  });

  await removeStaleDraftPhoto({ previous, published: row.photoUrl, affiliateId: ctx.affiliateId });

  return NextResponse.json(toPageState(updated));
}
