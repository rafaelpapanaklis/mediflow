export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReportsClient } from "./reports-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";
import { getServerT } from "@/i18n/server";

export const metadata: Metadata = { title: "Reportes — MediFlow" };

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; }
  catch (e) { console.error("[dashboard/reports] query failed:", e); return fallback; }
}

export default async function ReportsPage() {
  const { t }     = await getServerT();
  const user      = await getCurrentUser();
  requirePermissionOrRedirect(user, "reports.view");
  const clinicId  = user.clinicId;
  const now       = new Date();

  // Build 6-month date ranges
  const ranges = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 0, 23, 59, 59);
    return { start, end, label: start.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }) };
  });

  // Fechas para KPIs actuales
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const weekEnd = new Date(todayEnd.getTime() + 6 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Promise.all #1 — series mensuales (3 promesas)
  const [revenueResults, patientCounts, apptCounts] = await Promise.all([
    Promise.all(ranges.map(r =>
      safe(
        prisma.payment.aggregate({ where: { invoice: { clinicId }, paidAt: { gte: r.start, lte: r.end } }, _sum: { amount: true } }),
        { _sum: { amount: 0 } } as any,
      )
    )),
    Promise.all(ranges.map(r =>
      safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: r.start, lte: r.end } } }), 0)
    )),
    Promise.all(ranges.map(r =>
      safe(prisma.appointment.count({ where: { clinicId, startsAt: { gte: r.start, lte: r.end } } }), 0)
    )),
  ]);

  // Promise.all #2 — agregados de appointments (2 promesas)
  const [topTypes, byStatus] = await Promise.all([
    safe(prisma.appointment.groupBy({
      by: ["type"], where: { clinicId },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 6,
    }), [] as any[]),
    safe(prisma.appointment.groupBy({
      by: ["status"], where: { clinicId },
      _count: { id: true },
    }), [] as any[]),
  ]);

  // Promise.all #3 — KPIs actuales de pacientes y deuda (5 promesas)
  const [totalPatients, newThisMonth, newLastMonth, debtAggregate, debtCount] = await Promise.all([
    safe(prisma.patient.count({ where: { clinicId } }), 0),
    safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: startOfMonth } } }), 0),
    safe(prisma.patient.count({ where: { clinicId, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } } }), 0),
    safe(prisma.invoice.aggregate({
      where: { clinicId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      _sum: { balance: true },
    }), { _sum: { balance: 0 } } as any),
    safe(prisma.invoice.findMany({
      where: { clinicId, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
      select: { patientId: true },
      distinct: ["patientId"],
    }).then(rows => rows.length), 0),
  ]);

  // Promise.all #4 — KPIs citas, doctores, sillones (6 promesas)
  const [nextApptsToday, nextApptsWeek, activeDoctors, totalResources, resourcesByKind, topResourceUsage] = await Promise.all([
    safe(prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: todayStart, lte: todayEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    }), 0),
    safe(prisma.appointment.count({
      where: {
        clinicId,
        startsAt: { gte: todayStart, lte: weekEnd },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
    }), 0),
    safe(prisma.user.count({ where: { clinicId, role: "DOCTOR", isActive: true } }), 0),
    safe(prisma.resource.count({ where: { clinicId, isActive: true } }), 0),
    safe(prisma.resource.groupBy({
      by: ["kind"],
      where: { clinicId, isActive: true },
      _count: { id: true },
    }), [] as any[]),
    safe(prisma.appointment.groupBy({
      by: ["resourceId"],
      where: { clinicId, startsAt: { gte: thirtyDaysAgo }, resourceId: { not: null }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }), [] as any[]),
  ]);

  // Enriquecer top resources con el nombre del recurso (para mostrar en UI)
  const resourceIds = topResourceUsage.map((r: any) => r.resourceId).filter(Boolean) as string[];
  const resourceMeta = resourceIds.length > 0
    ? await safe(prisma.resource.findMany({
        where: { clinicId, id: { in: resourceIds } },
        select: { id: true, name: true, kind: true },
      }), [] as any[])
    : [];
  const topResources = topResourceUsage.map((r: any) => {
    const meta = resourceMeta.find((m: any) => m.id === r.resourceId);
    return {
      resourceId: r.resourceId,
      name: meta?.name ?? t("analytics.reportsPage.unnamedResource"),
      kind: meta?.kind ?? "OTHER",
      count: r._count.id,
    };
  });

  // Calcular delta % de pacientes nuevos vs mes anterior
  const newPctDelta = newLastMonth > 0
    ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100)
    : (newThisMonth > 0 ? 100 : 0);

  // Prisma tipa `_sum` como `... | null`. Defensa con Number().
  const monthlyData = ranges.map((r, i) => ({
    label:        r.label,
    revenue:      Number(revenueResults[i]?._sum?.amount ?? 0),
    patients:     patientCounts[i] ?? 0,
    appointments: apptCounts[i] ?? 0,
  }));

  // Sanitizar groupBy antes del Flight boundary
  const serialized = JSON.parse(JSON.stringify({ topTypes, byStatus, resourcesByKind, topResources }));

  // KPIs para el cliente
  const patientStats = {
    total: totalPatients,
    newThisMonth,
    newPctDelta,
    withDebt: debtCount,
    withDebtAmount: Number(debtAggregate?._sum?.balance ?? 0),
    nextApptsToday,
    nextApptsWeek,
  };

  const clinicStats = {
    activeDoctors,
    totalResources,
    resourcesByKind: serialized.resourcesByKind,
    topResources: serialized.topResources,
  };

  return (
    <ReportsClient
      monthlyData={monthlyData}
      topTypes={serialized.topTypes}
      byStatus={serialized.byStatus}
      patientStats={patientStats}
      clinicStats={clinicStats}
    />
  );
}
