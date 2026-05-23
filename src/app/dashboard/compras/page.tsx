export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  cartInclude,
  orderInclude,
  toSupplierCartDTO,
  toSupplierOrderDTO,
} from "@/lib/suppliers/serializers";
import { ComprasClient } from "./compras-client";

export const metadata: Metadata = { title: "Compras — MediFlow" };

export default async function ComprasPage() {
  const user = await getCurrentUser();

  const [carts, orders] = await Promise.all([
    prisma.supplierCart.findMany({
      where: { clinicId: user.clinicId },
      include: cartInclude,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.supplierOrder.findMany({
      where: { clinicId: user.clinicId },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Solo mostramos carritos con al menos un producto.
  const cartDTOs = carts
    .map(toSupplierCartDTO)
    .filter((c) => c.items.length > 0);
  const orderDTOs = orders.map(toSupplierOrderDTO);

  return <ComprasClient carts={cartDTOs} orders={orderDTOs} />;
}
