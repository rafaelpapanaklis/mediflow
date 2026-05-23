import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSupplierContext } from "@/lib/supplier-auth";
import type { SupplierProductDTO } from "@/lib/suppliers/types";

// Lee cookies de sesión (getSupplierContext) → siempre dinámico, nunca cacheado.
export const dynamic = "force-dynamic";

// Serializa un SupplierProduct (con sus imágenes) al DTO de red definido en
// el contrato compartido (@/lib/suppliers/types). Fechas como ISO string.
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

// ── GET /api/proveedores/products ────────────────────────────────────────
// Catálogo del proveedor en sesión. supplierId SIEMPRE de la sesión.
export async function GET() {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de proveedor no está aprobada." }, { status: 403 });
  }

  const products = await prisma.supplierProduct.findMany({
    where: { supplierId: ctx.supplierId },
    include: { images: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(products.map(serializeProduct));
}

// ── POST /api/proveedores/products ───────────────────────────────────────
// Crea un producto para el proveedor en sesión.
export async function POST(req: NextRequest) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Tu cuenta de proveedor no está aprobada." }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "El nombre del producto es requerido." }, { status: 400 });
  }

  const priceNum = typeof body?.price === "number" ? body.price : Number(body?.price);
  if (!Number.isFinite(priceNum) || priceNum < 0) {
    return NextResponse.json({ error: "El precio debe ser un número mayor o igual a 0." }, { status: 400 });
  }

  const stockRaw = body?.stock;
  const stockNum =
    stockRaw === undefined || stockRaw === null || stockRaw === ""
      ? 0
      : Math.floor(Number(stockRaw));
  if (!Number.isInteger(stockNum) || stockNum < 0) {
    return NextResponse.json({ error: "El stock debe ser un número entero mayor o igual a 0." }, { status: 400 });
  }

  const description =
    typeof body?.description === "string" && body.description.trim() ? body.description.trim() : null;
  const category =
    typeof body?.category === "string" && body.category.trim() ? body.category.trim() : null;
  const skuRaw = typeof body?.sku === "string" && body.sku.trim() ? body.sku.trim() : null;
  const unit =
    typeof body?.unit === "string" && body.unit.trim() ? body.unit.trim().slice(0, 20) : "pza";
  const isActive = typeof body?.isActive === "boolean" ? body.isActive : true;

  const product = await prisma.supplierProduct.create({
    data: {
      supplierId: ctx.supplierId, // SIEMPRE de la sesión, nunca del body.
      name: name.slice(0, 200),
      description,
      category,
      sku: skuRaw ? skuRaw.slice(0, 100) : null,
      price: Math.round(priceNum * 100) / 100,
      unit,
      stock: stockNum,
      isActive,
    },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json(serializeProduct(product), { status: 201 });
}
