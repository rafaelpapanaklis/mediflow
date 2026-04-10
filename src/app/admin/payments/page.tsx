export const dynamic = "force-dynamic";
import { prisma } from "@/lib/prisma";
import { PaymentsClient } from "./payments-client";

export default async function PaymentsPage() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [totalClinics, activeClinics, trialClinics, recentPayments, pendingTransfers] =
    await Promise.all([
      prisma.clinic.count(),
      prisma.clinic.count({ where: { subscriptionStatus: "active" } }),
      prisma.clinic.count({
        where: {
          subscriptionStatus: { in: ["trialing", null as any] },
          trialEndsAt: { gt: now },
        },
      }),
      prisma.subscriptionInvoice.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          clinic: { select: { id: true, name: true, plan: true } },
        },
      }),
      prisma.subscriptionInvoice.findMany({
        where: { status: "pending" },
        include: {
          clinic: { select: { id: true, name: true, plan: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const [expiredClinics, overdueClinics, thisMonthRev, prevMonthRev] =
    await Promise.all([
      prisma.clinic.count({
        where: {
          OR: [
            { subscriptionStatus: "cancelled" },
            { trialEndsAt: { lt: now }, subscriptionStatus: { not: "active" } },
          ],
        },
      }),
      prisma.clinic.findMany({
        where: {
          subscriptionStatus: { not: "active" },
          trialEndsAt: { lt: now },
        },
        select: {
          id: true,
          name: true,
          plan: true,
          email: true,
          trialEndsAt: true,
        },
        orderBy: { trialEndsAt: "desc" },
        take: 50,
      }),
      prisma.subscriptionInvoice.aggregate({
        where: { status: "paid", paidAt: { gte: firstOfMonth } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.subscriptionInvoice.aggregate({
        where: {
          status: "paid",
          paidAt: { gte: firstOfPrevMonth, lte: lastOfPrevMonth },
        },
        _sum: { amount: true },
      }),
    ]);

  const mrrResult = await prisma.clinic.aggregate({
    where: { subscriptionStatus: "active" },
    _sum: { monthlyPrice: true },
  });

  const clinics = await prisma.clinic.findMany({
    select: { id: true, name: true, plan: true, email: true, monthlyPrice: true },
    orderBy: { name: "asc" },
  });

  const thisMonth = thisMonthRev._sum.amount ?? 0;
  const prevMonth = prevMonthRev._sum.amount ?? 0;

  return (
    <PaymentsClient
      metrics={{
        totalClinics,
        activeClinics,
        trialClinics,
        expiredClinics,
        currentMRR: mrrResult._sum.monthlyPrice ?? 0,
        thisMonthRevenue: thisMonth,
        thisMonthPayments: thisMonthRev._count ?? 0,
        prevMonthRevenue: prevMonth,
        revenueChange:
          prevMonth > 0
            ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100)
            : 0,
      }}
      recentPayments={recentPayments as any}
      pendingTransfers={pendingTransfers as any}
      overdueClinics={overdueClinics as any}
      clinics={clinics as any}
    />
  );
}
