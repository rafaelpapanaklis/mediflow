// Serializadores Prisma → DTO para el lado clínica del marketplace (T3).
//
// Los `*Include` se comparten entre las rutas API y los server components
// de /dashboard/compras para garantizar que el JSON emitido tenga SIEMPRE
// la misma forma que los DTO declarados en `./types` (la fuente de verdad).
//
// Módulo SOLO de servidor: importa tipos de @prisma/client (borrados en
// compilación) y se usa desde rutas + server pages. Nunca importarlo desde
// un componente "use client"; ahí se importan los DTO de `./types`.

import type { Prisma, Supplier, SupplierOrderItem } from "@prisma/client";
import type {
  SupplierDTO,
  SupplierProductDTO,
  SupplierProductImageDTO,
  SupplierCartItemDTO,
  SupplierCartDTO,
  SupplierOrderItemDTO,
  SupplierOrderDTO,
} from "./types";

// ── Includes canónicos ────────────────────────────────────────────────
export const cartInclude = {
  supplier: true,
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      product: {
        include: { images: { orderBy: { sortOrder: "asc" } } },
      },
    },
  },
} satisfies Prisma.SupplierCartInclude;

export const orderInclude = {
  supplier: true,
  items: true,
} satisfies Prisma.SupplierOrderInclude;

type CartWith = Prisma.SupplierCartGetPayload<{ include: typeof cartInclude }>;
type OrderWith = Prisma.SupplierOrderGetPayload<{ include: typeof orderInclude }>;
type ProductWithImages = Prisma.SupplierProductGetPayload<{ include: { images: true } }>;

const iso = (d: Date): string => d.toISOString();

// ── Mapeadores ────────────────────────────────────────────────────────
export function toSupplierDTO(s: Supplier): SupplierDTO {
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
    status: s.status,
    approvedAt: s.approvedAt ? iso(s.approvedAt) : null,
    rejectedReason: s.rejectedReason,
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
  };
}

function toImageDTO(i: ProductWithImages["images"][number]): SupplierProductImageDTO {
  return {
    id: i.id,
    productId: i.productId,
    url: i.url,
    sortOrder: i.sortOrder,
    createdAt: iso(i.createdAt),
  };
}

export function toSupplierProductDTO(p: ProductWithImages): SupplierProductDTO {
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
    images: p.images.map(toImageDTO),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

function toCartItemDTO(it: CartWith["items"][number]): SupplierCartItemDTO {
  return {
    id: it.id,
    cartId: it.cartId,
    productId: it.productId,
    quantity: it.quantity,
    product: toSupplierProductDTO(it.product),
    createdAt: iso(it.createdAt),
  };
}

export function toSupplierCartDTO(c: CartWith): SupplierCartDTO {
  return {
    id: c.id,
    clinicId: c.clinicId,
    supplierId: c.supplierId,
    supplier: toSupplierDTO(c.supplier),
    items: c.items.map(toCartItemDTO),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

function toOrderItemDTO(it: SupplierOrderItem): SupplierOrderItemDTO {
  return {
    id: it.id,
    orderId: it.orderId,
    productId: it.productId,
    productName: it.productName,
    unitPrice: it.unitPrice,
    quantity: it.quantity,
    lineTotal: it.lineTotal,
  };
}

export function toSupplierOrderDTO(o: OrderWith): SupplierOrderDTO {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    clinicId: o.clinicId,
    supplierId: o.supplierId,
    supplier: toSupplierDTO(o.supplier),
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    subtotal: o.subtotal,
    total: o.total,
    notes: o.notes,
    items: o.items.map(toOrderItemDTO),
    createdAt: iso(o.createdAt),
    updatedAt: iso(o.updatedAt),
  };
}
