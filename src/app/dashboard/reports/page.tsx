import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReportsClient } from "./reports-client";
export const metadata: Metadata = { title: "Reportes — MediFlow" };
export default async function ReportsPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;
  const now = new Date();
  const months = Array.from({ length: 6 }).map((_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - (5-i), 1); return { year: d.getFullYear(), month: d.getMonth() }; });
  const monthlyData = await Promise.all(months.map(async ({ year, month }) => {
    const start = new Date(year, month, 1); const end = new Date(year, month+1, 0, 23, 59, 59);
    const [revenue, patients, appointments] = await Promise.all([
      prisma.invoice.aggregate({ where: { clinicId, paidAt: { gte: start, lte: end } }, _sum: { paid: true } }),
      prisma.patient.count({ where: { clinicId, createdAt: { gte: start, lte: end } } }),
      prisma.appointment.count({ where: { clinicId, date: { gte: start, lte: end } } }),
    ]);
    return { label: start.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }), revenue: revenue._sum.paid ?? 0, patients, appointments };
  }));
  const [topTypes, byStatus] = await Promise.all([
    prisma.appointment.groupBy({ by: ["type"], where: { clinicId }, _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 6 }),
    prisma.appointment.groupBy({ by: ["status"], where: { clinicId }, _count: { id: true } }),
  ]);
  return <ReportsClient monthlyData={monthlyData} topTypes={topTypes as any} byStatus={byStatus as any} />;
}
