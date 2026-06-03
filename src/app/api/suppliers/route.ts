import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { toSupplierDTO } from "@/lib/suppliers/serializers";

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

  const suppliers = await prisma.supplier.findMany({
    where,
    orderBy: { businessName: "asc" },
  });

  const dtos = suppliers.map((s) => toSupplierDTO(s));
  return NextResponse.json(dtos);
}
