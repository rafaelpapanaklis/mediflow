// Datos del dashboard del proveedor. Helper compartido entre el server
// component /proveedores/inicio y el endpoint GET /api/proveedores/dashboard
// para no duplicar la lógica de KPIs. SIEMPRE recibe el supplierId desde la
// sesión (getSupplierContext), nunca desde el request.

import { prisma } from "@/lib/prisma";
import type { SupplierOrderStatus, SupplierPaymentStatus } from "@/lib/suppliers/types";

export interface SupplierDashboardRecentOrder {
  id: string;
  orderNumber: string;
  clinicName: string;
  itemCount: number;
  total: number;
  status: SupplierOrderStatus;
  paymentStatus: SupplierPaymentStatus;
  createdAt: Date;
}

export interface SupplierDashboardData {
  salesThisMonth: number;
  salesPrevMonth: number;
  pendingOrders: number;
  activeProducts: number;
  totalOrders: number;
  recentOrders: SupplierDashboardRecentOrder[];
}

export async function getSupplierDashboardData(
  supplierId: string,
): Promise<SupplierDashboardData> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // 6 queries < 7 → un solo round-trip por el pooler (PgBouncer transaction mode).
  const [monthAgg, prevMonthAgg, pendingOrders, activeProducts, totalOrders, recent] =
    await Promise.all([
      prisma.supplierOrder.aggregate({
        _sum: { total: true },
        where: { supplierId, status: { not: "CANCELLED" }, createdAt: { gte: monthStart } },
      }),
      prisma.supplierOrder.aggregate({
        _sum: { total: true },
        where: {
          supplierId,
          status: { not: "CANCELLED" },
          createdAt: { gte: prevMonthStart, lt: monthStart },
        },
      }),
      prisma.supplierOrder.count({ where: { supplierId, status: "PENDING" } }),
      prisma.supplierProduct.count({ where: { supplierId, isActive: true } }),
      prisma.supplierOrder.count({ where: { supplierId } }),
      prisma.supplierOrder.findMany({
        where: { supplierId },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: {
          clinic: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

  return {
    salesThisMonth: monthAgg._sum.total ?? 0,
    salesPrevMonth: prevMonthAgg._sum.total ?? 0,
    pendingOrders,
    activeProducts,
    totalOrders,
    recentOrders: recent.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      clinicName: o.clinic.name,
      itemCount: o._count.items,
      total: o.total,
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    })),
  };
}
