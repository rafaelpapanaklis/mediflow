import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import type {
  SupplierDTO,
  SupplierProductDTO,
  SupplierProductImageDTO,
} from "@/lib/suppliers/types";

// Mapea un Supplier de Prisma al DTO de red (sin el array products, que va
// aparte en la respuesta). Fechas Date → ISO string.
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

function toImageDTO(img: any): SupplierProductImageDTO {
  return {
    id: img.id,
    productId: img.productId,
    url: img.url,
    sortOrder: img.sortOrder,
    createdAt: img.createdAt.toISOString(),
  };
}

function toProductDTO(p: any): SupplierProductDTO {
  return {
    id: p.id,
    supplierId: p.supplierId,
    name: p.name,
    description: p.description,
    category: p.category,
    sku: p.sku,
    price: p.price,
    unit: p.unit,
    stock: p.stock,
    isActive: p.isActive,
    images: (p.images ?? []).map(toImageDTO),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// GET /api/suppliers/[supplierId] — ficha del proveedor + sus productos activos.
export async function GET(
  req: NextRequest,
  { params }: { params: { supplierId: string } }
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supplier = await prisma.supplier.findFirst({
    where: { id: params.supplierId, status: "APPROVED" },
    include: {
      products: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        include: { images: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!supplier) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }

  const products: SupplierProductDTO[] = supplier.products.map(toProductDTO);

  return NextResponse.json({
    supplier: toSupplierDTO(supplier),
    products,
  });
}
