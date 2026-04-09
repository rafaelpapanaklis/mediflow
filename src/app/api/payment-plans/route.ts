import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

// GET /api/payment-plans?patientId=xxx
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patientId = new URL(req.url).searchParams.get("patientId");

  const plans = await prisma.paymentPlan.findMany({
    where: {
      clinicId:  ctx.clinicId,
      ...(patientId ? { patientId } : {}),
    },
    include: {
      patient:  { select: { id: true, firstName: true, lastName: true } },
      payments: { orderBy: { installment: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(plans);
}

// POST /api/payment-plans — create plan + generate installments
export async function POST(req: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { patientId, invoiceId, name, totalAmount, downPayment, installments, frequency, startDate, notes } = body;

  if (!patientId || !name || !totalAmount || !installments) {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
  }

  // Create the plan
  const plan = await prisma.paymentPlan.create({
    data: {
      clinicId:     ctx.clinicId,
      patientId,
      invoiceId:    invoiceId ?? null,
      name,
      totalAmount,
      downPayment:  downPayment ?? 0,
      installments,
      frequency:    frequency ?? "MONTHLY",
      startDate:    startDate ? new Date(startDate) : new Date(),
      notes:        notes ?? null,
      status:       "ACTIVE",
    },
  });

  // Generate installments
  const remaining    = totalAmount - (downPayment ?? 0);
  const perInstall   = Math.round((remaining / installments) * 100) / 100;
  const freqDays     = frequency === "WEEKLY" ? 7 : frequency === "BIWEEKLY" ? 14 : 30;
  const start        = startDate ? new Date(startDate) : new Date();

  const installmentData = Array.from({ length: installments }, (_, i) => {
    const dueDate = new Date(start);
    dueDate.setDate(dueDate.getDate() + freqDays * (i + 1));
    // Last installment gets the residual to avoid rounding errors
    const amount = i === installments - 1
      ? Math.round((remaining - perInstall * (installments - 1)) * 100) / 100
      : perInstall;
    return {
      planId:      plan.id,
      installment: i + 1,
      amount,
      dueDate,
    };
  });

  await prisma.planPayment.createMany({ data: installmentData });

  const result = await prisma.paymentPlan.findUnique({
    where:   { id: plan.id },
    include: { payments: { orderBy: { installment: "asc" } } },
  });

  return NextResponse.json(result, { status: 201 });
}
