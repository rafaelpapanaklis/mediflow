export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReportsClient } from "./reports-client";

export const metadata: Metadata = { title: "Reportes — MediFlow" };

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try { return await p; }
  catch (e) { console.error("[dashboard/reports] query failed:", e); return fallback; }
}

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

  const [revenueResults, patientCounts, apptCounts, topTypes, byStatus] = await Promise.all([
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
    safe(prisma.appointment.groupBy({
      by: ["type"], where: { clinicId },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 6,
    }), [] as any[]),
    safe(prisma.appointment.groupBy({
      by: ["status"], where: { clinicId },
      _count: { id: true },
    }), [] as any[]),
  ]);

  // Prisma tipa `_sum` como `... | null` (puede venir null si 0 filas matchean
  // el where). Optional chaining + Number() defiende contra null y contra un
  // posible Decimal si la columna en prod fuese NUMERIC.
  const monthlyData = ranges.map((r, i) => ({
    label:        r.label,
    revenue:      Number(revenueResults[i]?._sum?.amount ?? 0),
    patients:     patientCounts[i] ?? 0,
    appointments: apptCounts[i] ?? 0,
  }));

  // Sanitizamos los groupBy antes del Flight boundary para evitar que un
  // Decimal/class-instance reviente el render de React (no atrapable por
  // try/catch porque ocurre después del return).
  const serialized = JSON.parse(JSON.stringify({ topTypes, byStatus }));

  return (
    <ReportsClient
      monthlyData={monthlyData}
      topTypes={serialized.topTypes}
      byStatus={serialized.byStatus}
    />
  );
}
