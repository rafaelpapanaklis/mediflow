export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OverviewClient } from "./overview-client";
import { requirePermissionOrRedirect } from "@/lib/auth/require-permission";

export const metadata: Metadata = { title: "Analytics — MediFlow" };

const MIN_APPTS_FOR_INSIGHTS = 30;

export default async function AnalyticsOverviewPage() {
  const user = await getCurrentUser();
  requirePermissionOrRedirect(user, "analytics.view");
  const clinicId = user.clinicId;

  // Solo admin/owner ven analytics.
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
        Solo los administradores tienen acceso a Analytics.
      </div>
    );
  }

  // Conteo de citas históricas para detectar "Recolectando datos…".
  const totalAppts = await prisma.appointment.count({ where: { clinicId } });
  const insufficientData = totalAppts < MIN_APPTS_FOR_INSIGHTS;
  const dataProgress = Math.min(100, Math.round((totalAppts / MIN_APPTS_FOR_INSIGHTS) * 100));

  // KPIs del mes actual + comparativa mes anterior. Calculamos server-side
  // para evitar flash en el primer render. El cliente luego refresca el
  // efficiency score (que necesita hora-por-hora) vía API.
  const now = new Date();
  const firstMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstPrev  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastPrev   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const today      = new Date(now); today.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  const [
    monthAppts, prevAppts,
    completedMonth, prevCompletedMonth,
    noShowMonth, prevNoShowMonth,
    avgWaitMin, todayCount,
  ] = await Promise.all([
    prisma.appointment.count({ where: { clinicId, startsAt: { gte: firstMonth }, status: { not: "CANCELLED" } } }),
    prisma.appointment.count({ where: { clinicId, startsAt: { gte: firstPrev, lte: lastPrev }, status: { not: "CANCELLED" } } }),
    prisma.appointment.count({ where: { clinicId, startsAt: { gte: firstMonth }, status: { in: ["COMPLETED", "CHECKED_OUT"] } } }),
    prisma.appointment.count({ where: { clinicId, startsAt: { gte: firstPrev, lte: lastPrev }, status: { in: ["COMPLETED", "CHECKED_OUT"] } } }),
    prisma.appointment.count({ where: { clinicId, startsAt: { gte: firstMonth }, status: "NO_SHOW" } }),
    prisma.appointment.count({ where: { clinicId, startsAt: { gte: firstPrev, lte: lastPrev }, status: "NO_SHOW" } }),
    prisma.appointmentTimeline.aggregate({
      where: {
        appointment: { clinicId, startsAt: { gte: firstMonth } },
        totalWaitMin: { not: null },
      },
      _avg: { totalWaitMin: true },
    }),
    prisma.appointment.count({ where: { clinicId, startsAt: { gte: today, lte: todayEnd }, status: { not: "CANCELLED" } } }),
  ]);

  const noShowRate = monthAppts > 0 ? (noShowMonth / monthAppts) * 100 : 0;
  const prevNoShowRate = prevAppts > 0 ? (prevNoShowMonth / prevAppts) * 100 : 0;

  return (
    <OverviewClient
      data={{
        monthAppts,
        prevAppts,
        apptsDeltaPct: pct(monthAppts, prevAppts),
        completedMonth,
        prevCompletedMonth,
        completedDeltaPct: pct(completedMonth, prevCompletedMonth),
        noShowMonth,
        noShowRate: Math.round(noShowRate * 10) / 10,
        noShowDeltaPct: prevNoShowRate > 0 ? Math.round(((noShowRate - prevNoShowRate) / prevNoShowRate) * 100) : 0,
        avgWaitMin: avgWaitMin._avg.totalWaitMin ?? null,
        todayCount,
        insufficientData,
        dataProgress,
        totalAppts,
      }}
    />
  );
}

function pct(curr: number, prev: number): number {
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}
