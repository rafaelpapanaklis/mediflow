import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { toSupplierDTO } from "@/lib/suppliers/serializers";
import { parsePageParams } from "@/lib/pagination";

// Directorio global cacheado 5 min por combinación de filtros (los args son
// parte de la key del data cache). Se cachean los DTO ya serializados (JSON
// plano, fechas en ISO) y SIN isFavorite — eso es per-clinic y se resuelve
// fuera del cache en cada request. Tag "suppliers" listo para revalidateTag()
// desde los flujos de alta/aprobación admin.
const listApprovedSuppliers = unstable_cache(
  async (search: string | null, category: string | null, take: number, skip: number) => {
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

    const suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { businessName: "asc" },
      take,
      skip,
    });
    return suppliers.map((s) => toSupplierDTO(s));
  },
  ["suppliers-directory"],
  { revalidate: 300, tags: ["suppliers"] },
);

// GET /api/suppliers — proveedores APPROVED para el directorio de la clínica.
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const searchParams = new URL(req.url).searchParams;
  const search = searchParams.get("search");
  const category = searchParams.get("category");
  const { take, skip } = parsePageParams(searchParams);

  const cached = await listApprovedSuppliers(search, category, take, skip);

  // Favoritos de la clínica de sesión → set de supplierId para marcar
  // `isFavorite` en cada DTO. clinicId SIEMPRE de la sesión, nunca del
  // request; por eso esta query queda FUERA del cache global.
  const favorites = await prisma.supplierFavorite.findMany({
    where: { clinicId: ctx.clinicId },
    select: { supplierId: true },
  });
  const favSet = new Set(favorites.map((f) => f.supplierId));

  const dtos = cached.map((s) => (favSet.has(s.id) ? { ...s, isFavorite: true } : s));
  return NextResponse.json(dtos);
}
