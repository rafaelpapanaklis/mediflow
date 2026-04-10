import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

function isAdmin(req: NextRequest): boolean {
  const token = req.cookies.get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

// GET — Dashboard metrics
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  // Parallel queries (max 7)
  const [totalClinics, activeClinics, trialClinics, expiredClinics, thisMonthRevenue, prevMonthRevenue, recentPayments] = await Promise.all([
    prisma.clinic.count(),
    prisma.clinic.count({ where: { subscriptionStatus: "active" } }),
    prisma.clinic.count({ where: { subscriptionStatus: { in: ["trialing", null] }, trialEndsAt: { gt: now } } }),
    prisma.clinic.count({ where: { OR: [{ subscriptionStatus: "cancelled" }, { trialEndsAt: { lt: now }, subscriptionStatus: { not: "active" } }] } }),
    prisma.subscriptionInvoice.aggregate({ where: { status: "paid", paidAt: { gte: firstOfMonth } }, _sum: { amount: true }, _count: true }),
    prisma.subscriptionInvoice.aggregate({ where: { status: "paid", paidAt: { gte: firstOfPrevMonth, lte: lastOfPrevMonth } }, _sum: { amount: true }, _count: true }),
    prisma.subscriptionInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { clinic: { select: { id: true, name: true, plan: true } } } }),
  ]);

  // Revenue by method
  const byMethod = await prisma.subscriptionInvoice.groupBy({
    by: ["method"],
    where: { status: "paid", paidAt: { gte: firstOfMonth } },
    _sum: { amount: true },
    _count: true,
  });

  // Monthly revenue for chart (last 6 months)
  const monthlyRevenue: { month: string; revenue: number; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const data = await prisma.subscriptionInvoice.aggregate({
      where: { status: "paid", paidAt: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    });
    monthlyRevenue.push({
      month: start.toLocaleDateString("es-MX", { month: "short", year: "numeric" }),
      revenue: data._sum.amount ?? 0,
      count: data._count ?? 0,
    });
  }

  // Pending transfers to verify
  const pendingTransfers = await prisma.subscriptionInvoice.findMany({
    where: { status: "pending", method: { in: ["transfer", "deposit", "oxxo", "paypal"] } },
    include: { clinic: { select: { id: true, name: true, plan: true, email: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Overdue clinics (past trial, no active subscription)
  const overdueClinics = await prisma.clinic.findMany({
    where: { subscriptionStatus: { not: "active" }, trialEndsAt: { lt: now } },
    select: { id: true, name: true, plan: true, email: true, trialEndsAt: true, createdAt: true },
    orderBy: { trialEndsAt: "desc" },
    take: 30,
  });

  const currentMRR = activeClinics > 0
    ? (await prisma.clinic.aggregate({ where: { subscriptionStatus: "active" }, _sum: { monthlyPrice: true } }))._sum.monthlyPrice ?? 0
    : 0;

  return NextResponse.json({
    metrics: {
      totalClinics, activeClinics, trialClinics, expiredClinics,
      currentMRR,
      thisMonthRevenue: thisMonthRevenue._sum.amount ?? 0,
      thisMonthPayments: thisMonthRevenue._count ?? 0,
      prevMonthRevenue: prevMonthRevenue._sum.amount ?? 0,
      revenueChange: (prevMonthRevenue._sum.amount ?? 0) > 0
        ? Math.round(((thisMonthRevenue._sum.amount ?? 0) - (prevMonthRevenue._sum.amount ?? 0)) / (prevMonthRevenue._sum.amount ?? 1) * 100)
        : 0,
    },
    byMethod,
    monthlyRevenue,
    recentPayments,
    pendingTransfers,
    overdueClinics,
  });
}

// POST — Verify/confirm a pending payment
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  if (action === "verify_payment") {
    const { invoiceId } = body;
    const invoice = await prisma.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    await prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: { status: "paid", paidAt: new Date() },
    });

    // Activate the clinic's subscription
    const nextBilling = new Date();
    nextBilling.setMonth(nextBilling.getMonth() + 1);
    await prisma.clinic.update({
      where: { id: invoice.clinicId },
      data: {
        subscriptionStatus: "active",
        nextBillingDate: nextBilling,
        monthlyPrice: invoice.amount,
      },
    });

    return NextResponse.json({ success: true });
  }

  if (action === "reject_payment") {
    const { invoiceId, reason } = body;
    await prisma.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: { status: "failed", notes: reason ?? "Pago rechazado por admin" },
    });
    return NextResponse.json({ success: true });
  }

  if (action === "activate_clinic") {
    const { clinicId, plan, months } = body;
    const nextBilling = new Date();
    nextBilling.setMonth(nextBilling.getMonth() + (months ?? 1));
    const PRICES: Record<string, number> = { BASIC: 299, PRO: 499, CLINIC: 799 };

    await prisma.clinic.update({
      where: { id: clinicId },
      data: {
        subscriptionStatus: "active",
        plan: plan as any,
        nextBillingDate: nextBilling,
        monthlyPrice: PRICES[plan] ?? 499,
      },
    });

    return NextResponse.json({ success: true });
  }

  if (action === "suspend_clinic") {
    const { clinicId } = body;
    await prisma.clinic.update({
      where: { id: clinicId },
      data: { subscriptionStatus: "cancelled" },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
