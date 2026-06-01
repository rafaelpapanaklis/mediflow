// Datos del dashboard del laboratorio. Helper compartido entre el server
// component /laboratorios/inicio y el endpoint GET /api/laboratorios/dashboard
// para no duplicar la lógica de KPIs. SIEMPRE recibe el labId desde la sesión
// (getDentalLabContext), nunca desde el request. Espejo de
// src/lib/suppliers/dashboard.ts adaptado al modelo de órdenes de laboratorio
// (servicio único por orden, sin carrito de productos).

import { prisma } from "@/lib/prisma";
import type {
  DentalLabOrderStatus,
  DentalLabPaymentStatus,
} from "@/lib/laboratorios/types";

export interface DentalLabDashboardRecentOrder {
  id: string;
  orderNumber: string;
  clinicName: string;
  serviceName: string | null;
  patientName: string | null;
  total: number;
  status: DentalLabOrderStatus;
  paymentStatus: DentalLabPaymentStatus;
  createdAt: Date;
}

export interface DentalLabDashboardData {
  salesThisMonth: number;
  salesPrevMonth: number;
  pendingOrders: number; // SOLICITADA — esperan que el lab las reciba
  activeOrders: number; // RECIBIDA + ATENDIENDO + ENVIADA (en proceso)
  activeServices: number;
  totalOrders: number;
  statusCounts: Record<DentalLabOrderStatus, number>;
  recentOrders: DentalLabDashboardRecentOrder[];
}

const EMPTY_STATUS_COUNTS: Record<DentalLabOrderStatus, number> = {
  SOLICITADA: 0,
  RECIBIDA: 0,
  ATENDIENDO: 0,
  ENVIADA: 0,
  ENTREGADA: 0,
  CANCELADA: 0,
};

export async function getDentalLabDashboardData(
  labId: string,
): Promise<DentalLabDashboardData> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  // 5 queries < 7 → un solo round-trip por el pooler (PgBouncer transaction mode).
  const [monthAgg, prevMonthAgg, activeServices, statusGroups, recent] =
    await Promise.all([
      prisma.dentalLabOrder.aggregate({
        _sum: { total: true },
        where: { labId, status: { not: "CANCELADA" }, createdAt: { gte: monthStart } },
      }),
      prisma.dentalLabOrder.aggregate({
        _sum: { total: true },
        where: {
          labId,
          status: { not: "CANCELADA" },
          createdAt: { gte: prevMonthStart, lt: monthStart },
        },
      }),
      prisma.dentalLabService.count({ where: { labId, isActive: true } }),
      prisma.dentalLabOrder.groupBy({
        by: ["status"],
        where: { labId },
        _count: { _all: true },
      }),
      prisma.dentalLabOrder.findMany({
        where: { labId },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: {
          clinic: { select: { name: true } },
          service: { select: { name: true } },
        },
      }),
    ]);

  const statusCounts: Record<DentalLabOrderStatus, number> = { ...EMPTY_STATUS_COUNTS };
  let totalOrders = 0;
  statusGroups.forEach((g) => {
    const count = g._count._all;
    statusCounts[g.status] = count;
    totalOrders += count;
  });

  return {
    salesThisMonth: monthAgg._sum.total ?? 0,
    salesPrevMonth: prevMonthAgg._sum.total ?? 0,
    pendingOrders: statusCounts.SOLICITADA,
    activeOrders: statusCounts.RECIBIDA + statusCounts.ATENDIENDO + statusCounts.ENVIADA,
    activeServices,
    totalOrders,
    statusCounts,
    recentOrders: recent.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      clinicName: o.clinic.name,
      serviceName: o.service?.name ?? null,
      patientName: o.patientName,
      total: o.total,
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    })),
  };
}
