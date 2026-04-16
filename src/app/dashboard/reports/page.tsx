export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReportsClient } from "./reports-client";

export const metadata: Metadata = { title: "Reportes — MediFlow" };

export default async function ReportsPage() {
  const user      = await getCurrentUser();
  const clinicId  = user.clinicId;
  const now       = new Date();

  // Build 6-month date ranges
  const ranges = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() - (5 - i) + 1, 0, 23, 59, 59);
    return { start, end, label: start.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }) };
  });

  // FIX: run all 18 queries in parallel instead of 6 sequential loops
  const [revenueResults, patientCounts, apptCounts, topTypes, byStatus] = await Promise.all([
    Promise.all(ranges.map(r =>
      prisma.payment.aggregate({ where: { invoice: { clinicId }, paidAt: { gte: r.start, lte: r.end } }, _sum: { amount: true } })
    )),
    Promise.all(ranges.map(r =>
      prisma.patient.count({ where: { clinicId, createdAt: { gte: r.start, lte: r.end } } })
    )),
    Promise.all(ranges.map(r =>
      prisma.appointment.count({ where: { clinicId, date: { gte: r.start, lte: r.end } } })
    )),
    prisma.appointment.groupBy({
      by: ["type"], where: { clinicId },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 6,
    }),
    prisma.appointment.groupBy({
      by: ["status"], where: { clinicId },
      _count: { id: true },
    }),
  ]);

  const monthlyData = ranges.map((r, i) => ({
    label:        r.label,
    revenue:      revenueResults[i]._sum.amount ?? 0,
    patients:     patientCounts[i],
    appointments: apptCounts[i],
  }));

  return (
    <ReportsClient
      monthlyData={monthlyData}
      topTypes={topTypes as any}
      byStatus={byStatus as any}
    />
  );
}
