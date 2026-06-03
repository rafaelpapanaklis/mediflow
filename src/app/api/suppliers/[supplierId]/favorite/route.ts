import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST /api/suppliers/[supplierId]/favorite — alterna el favorito de la clínica
// en sesión sobre un proveedor. Si ya existe el SupplierFavorite
// (clinicId, supplierId) lo borra; si no, lo crea. Responde { isFavorite }.
//
// SEGURIDAD MULTI-TENANT: el clinicId SIEMPRE sale de la sesión
// (getAuthContext), nunca del body. El supplierId viene del path.
export async function POST(
  _req: Request,
  { params }: { params: { supplierId: string } },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { supplierId } = params;

  // El proveedor debe existir para poder marcarlo como favorito.
  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true },
  });
  if (!supplier) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }

  const existing = await prisma.supplierFavorite.findUnique({
    where: { clinicId_supplierId: { clinicId: ctx.clinicId, supplierId } },
    select: { id: true },
  });

  let isFavorite: boolean;
  if (existing) {
    await prisma.supplierFavorite.delete({ where: { id: existing.id } });
    isFavorite = false;
  } else {
    // El @@unique(clinicId, supplierId) blinda contra duplicados: si un
    // doble-click concurrente ya lo creó, lo tratamos como "ya es favorito"
    // en lugar de romper con un 500 por violación de unicidad (P2002).
    try {
      await prisma.supplierFavorite.create({
        data: { clinicId: ctx.clinicId, supplierId },
      });
    } catch (err) {
      if ((err as { code?: string })?.code !== "P2002") throw err;
    }
    isFavorite = true;
  }

  return NextResponse.json({ isFavorite });
}
