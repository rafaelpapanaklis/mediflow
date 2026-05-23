import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSupplierContext } from "@/lib/supplier-auth";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { SUPPLIER_PRODUCTS_BUCKET, type SupplierProductDTO } from "@/lib/suppliers/types";

// Lee cookies de sesión (getSupplierContext) → siempre dinámico, nunca cacheado.
export const dynamic = "force-dynamic";

function serializeProduct(p: any): SupplierProductDTO {
  return {
    id: p.id,
    supplierId: p.supplierId,
    name: p.name,
    description: p.description ?? null,
    category: p.category ?? null,
    sku: p.sku ?? null,
    price: p.price,
    unit: p.unit,
    stock: p.stock,
    isActive: p.isActive,
    images: (p.images ?? []).map((img: any) => ({
      id: img.id,
      productId: img.productId,
      url: img.url,
      sortOrder: img.sortOrder,
      createdAt: img.createdAt.toISOString(),
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// Extrae el path interno del bucket público a partir de la URL guardada.
function pathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${SUPPLIER_PRODUCTS_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  return decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
}

// ── GET /api/proveedores/products/[productId] ─────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { productId: string } }) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de proveedor no está aprobada." }, { status: 403 });
  }

  // Multi-tenant guard: el producto DEBE pertenecer al proveedor en sesión.
  const product = await prisma.supplierProduct.findFirst({
    where: { id: params.productId, supplierId: ctx.supplierId },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  if (!product) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  return NextResponse.json(serializeProduct(product));
}

// ── PATCH /api/proveedores/products/[productId] ───────────────────────────
export async function PATCH(req: NextRequest, { params }: { params: { productId: string } }) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de proveedor no está aprobada." }, { status: 403 });
  }

  const existing = await prisma.supplierProduct.findFirst({
    where: { id: params.productId, supplierId: ctx.supplierId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  // Solo aplicamos los campos presentes en el body (update parcial).
  const data: Prisma.SupplierProductUpdateInput = {};

  if (typeof body?.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "El nombre del producto es requerido." }, { status: 400 });
    data.name = name.slice(0, 200);
  }
  if (body?.price !== undefined) {
    const priceNum = typeof body.price === "number" ? body.price : Number(body.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return NextResponse.json({ error: "El precio debe ser un número mayor o igual a 0." }, { status: 400 });
    }
    data.price = Math.round(priceNum * 100) / 100;
  }
  if (body?.stock !== undefined) {
    const stockNum = Math.floor(Number(body.stock));
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      return NextResponse.json({ error: "El stock debe ser un número entero mayor o igual a 0." }, { status: 400 });
    }
    data.stock = stockNum;
  }
  if (body?.description !== undefined) {
    data.description =
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }
  if (body?.category !== undefined) {
    data.category =
      typeof body.category === "string" && body.category.trim() ? body.category.trim() : null;
  }
  if (body?.sku !== undefined) {
    const sku = typeof body.sku === "string" && body.sku.trim() ? body.sku.trim() : null;
    data.sku = sku ? sku.slice(0, 100) : null;
  }
  if (body?.unit !== undefined) {
    data.unit =
      typeof body.unit === "string" && body.unit.trim() ? body.unit.trim().slice(0, 20) : "pza";
  }
  if (typeof body?.isActive === "boolean") {
    data.isActive = body.isActive;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No hay cambios que aplicar." }, { status: 400 });
  }

  const updated = await prisma.supplierProduct.update({
    where: { id: existing.id },
    data,
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json(serializeProduct(updated));
}

// ── DELETE /api/proveedores/products/[productId] ──────────────────────────
// Hard delete: el schema cascada las imágenes y los items de carrito, y pone
// productId=null en los items de pedidos (preservando el historial de compra).
export async function DELETE(_req: NextRequest, { params }: { params: { productId: string } }) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de proveedor no está aprobada." }, { status: 403 });
  }

  const product = await prisma.supplierProduct.findFirst({
    where: { id: params.productId, supplierId: ctx.supplierId },
    include: { images: true },
  });
  if (!product) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });

  // Borra los archivos del bucket (best-effort: no debe frenar el delete).
  try {
    const paths = product.images
      .map((img) => pathFromPublicUrl(img.url))
      .filter((p): p is string => Boolean(p));
    if (paths.length > 0) {
      const supabase = createAdmin(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } },
      );
      await supabase.storage.from(SUPPLIER_PRODUCTS_BUCKET).remove(paths);
    }
  } catch (e) {
    console.error("[proveedores/products] storage delete (non-fatal):", e);
  }

  await prisma.supplierProduct.delete({ where: { id: product.id } });

  return NextResponse.json({ success: true });
}
