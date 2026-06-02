import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type { SupplierDTO } from "@/lib/suppliers/types";

// Mapea un Supplier de Prisma al DTO de red (fechas Date → ISO string).
function toSupplierDTO(s: any): SupplierDTO {
  return {
    id: s.id,
    businessName: s.businessName,
    slug: s.slug,
    rfc: s.rfc,
    email: s.email,
    phone: s.phone,
    address: s.address,
    city: s.city,
    state: s.state,
    logoUrl: s.logoUrl,
    description: s.description,
    categories: s.categories,
    paymentMethods: s.paymentMethods,
    payTransferEnabled: s.payTransferEnabled,
    payMercadoPagoEnabled: s.payMercadoPagoEnabled,
    payCashEnabled: s.payCashEnabled,
    status: s.status,
    approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
    rejectedReason: s.rejectedReason,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

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

  const dtos = suppliers.map(toSupplierDTO);
  return NextResponse.json(dtos);
}
