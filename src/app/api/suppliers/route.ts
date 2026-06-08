import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { toSupplierDTO } from "@/lib/suppliers/serializers";
import { parsePageParams } from "@/lib/pagination";

// GET /api/suppliers — proveedores APPROVED para el directorio de la clínica.
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const searchParams = new URL(req.url).searchParams;
  const search = searchParams.get("search");
  const category = searchParams.get("category");

  const where: any = { status: "APPROVED" };

  if (category) {
    where.categories = { has: category };
  }

  if (search) {
    where.OR = [
      { businessName: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { city: { contains: search, mode: "insensitive" } },
    ];
  }

  const { take, skip } = parsePageParams(searchParams);
  const suppliers = await prisma.supplier.findMany({
    where,
    orderBy: { businessName: "asc" },
    take,
    skip,
  });

  // Favoritos de la clínica de sesión → set de supplierId para marcar
  // `isFavorite` en cada DTO. clinicId SIEMPRE de la sesión, nunca del request.
  const favorites = await prisma.supplierFavorite.findMany({
    where: { clinicId: ctx.clinicId },
    select: { supplierId: true },
  });
  const favSet = new Set(favorites.map((f) => f.supplierId));

  const dtos = suppliers.map((s) => toSupplierDTO(s, { isFavorite: favSet.has(s.id) }));
  return NextResponse.json(dtos);
}
