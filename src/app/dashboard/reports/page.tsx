export const dynamic = "force-dynamic";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReportsClient } from "./reports-client";
export default async function ReportsPage() {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;
  const now = new Date();
  const monthlyData = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end   = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const revenue      = await prisma.invoice.aggregate({ where: { clinicId, paidAt: { gte: start, lte: end } }, _sum: { paid: true } });
    const patients     = await prisma.patient.count({ where: { clinicId, createdAt: { gte: start, lte: end } } });
    const appointments = await prisma.appointment.count({ where: { clinicId, date: { gte: start, lte: end } } });
    monthlyData.push({ label: start.toLocaleDateString("es-MX", { month: "short", year: "2-digit" }), revenue: revenue._sum.paid ?? 0, patients, appointments });
  }
  const topTypes = await prisma.appointment.groupBy({ by: ["type"], where: { clinicId }, _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 6 });
  const byStatus = await prisma.appointment.groupBy({ by: ["status"], where: { clinicId }, _count: { id: true } });
  return <ReportsClient monthlyData={monthlyData} topTypes={topTypes as any} byStatus={byStatus as any} />;
}
