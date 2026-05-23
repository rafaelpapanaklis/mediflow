import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupplierContext } from "@/lib/supplier-auth";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { validateMagicNumber } from "@/lib/validate-upload";
import { SUPPLIER_PRODUCTS_BUCKET, type SupplierProductImageDTO } from "@/lib/suppliers/types";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGES = 8;

function getAdminSupabase() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function pathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${SUPPLIER_PRODUCTS_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
}

// ── POST /api/proveedores/products/[productId]/images ─────────────────────
// Sube una imagen al bucket público supplier-products y crea el registro.
export async function POST(req: NextRequest, { params }: { params: { productId: string } }) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de proveedor no está aprobada." }, { status: 403 });
  }

  // Multi-tenant guard: el producto DEBE pertenecer al proveedor en sesión.
  const owned = await prisma.supplierProduct.findFirst({
    where: { id: params.productId, supplierId: ctx.supplierId },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  const count = await prisma.supplierProductImage.count({ where: { productId: params.productId } });
  if (count >= MAX_IMAGES) {
    return NextResponse.json({ error: `Máximo ${MAX_IMAGES} imágenes por producto.` }, { status: 400 });
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
    return NextResponse.json(
      { error: "Tipo de archivo no permitido. Usa JPG, PNG, WebP o GIF." },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "La imagen supera el máximo de 10 MB." }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();

  // El MIME del browser es falseable: validamos el magic number real.
  const magicError = await validateMagicNumber(bytes, ALLOWED_TYPES);
  if (magicError) return NextResponse.json({ error: magicError }, { status: 400 });

  const ext =
    (file.name.split(".").pop() ?? "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "jpg";
  // El path lleva supplierId y productId → multi-tenant también en el storage.
  const path = `${ctx.supplierId}/${params.productId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const supabase = getAdminSupabase();
  const { error: uploadError } = await supabase.storage
    .from(SUPPLIER_PRODUCTS_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("[proveedores/products/images] upload error:", uploadError);
    return NextResponse.json({ error: "Error al subir la imagen." }, { status: 500 });
  }

  // Bucket público: guardamos la URL pública directamente renderizable.
  const { data: pub } = supabase.storage.from(SUPPLIER_PRODUCTS_BUCKET).getPublicUrl(path);
  if (!pub?.publicUrl) {
    return NextResponse.json({ error: "No se pudo generar la URL de la imagen." }, { status: 500 });
  }

  const image = await prisma.supplierProductImage.create({
    data: { productId: params.productId, url: pub.publicUrl, sortOrder: count },
  });

  const dto: SupplierProductImageDTO = {
    id: image.id,
    productId: image.productId,
    url: image.url,
    sortOrder: image.sortOrder,
    createdAt: image.createdAt.toISOString(),
  };
  return NextResponse.json(dto, { status: 201 });
}

// ── DELETE /api/proveedores/products/[productId]/images ───────────────────
// Quita una imagen. Acepta { imageId } o { url } en el body.
export async function DELETE(req: NextRequest, { params }: { params: { productId: string } }) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de proveedor no está aprobada." }, { status: 403 });
  }

  const owned = await prisma.supplierProduct.findFirst({
    where: { id: params.productId, supplierId: ctx.supplierId },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* body opcional vacío → caemos en la validación de abajo */
  }
  const imageId = typeof body?.imageId === "string" ? body.imageId : null;
  const url = typeof body?.url === "string" ? body.url : null;
  if (!imageId && !url) {
    return NextResponse.json({ error: "Especifica imageId o url." }, { status: 400 });
  }

  const image = await prisma.supplierProductImage.findFirst({
    where: { productId: params.productId, ...(imageId ? { id: imageId } : { url: url! }) },
  });
  if (!image) return NextResponse.json({ error: "Imagen no encontrada." }, { status: 404 });

  // Borra el archivo del bucket (best-effort).
  try {
    const p = pathFromPublicUrl(image.url);
    if (p) await getAdminSupabase().storage.from(SUPPLIER_PRODUCTS_BUCKET).remove([p]);
  } catch (e) {
    console.error("[proveedores/products/images] storage delete (non-fatal):", e);
  }

  await prisma.supplierProductImage.delete({ where: { id: image.id } });

  return NextResponse.json({ success: true });
}
