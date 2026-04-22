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

  // Multi-tenant verification: ensure patient belongs to this clinic
  const patient = await prisma.patient.findFirst({
    where:  { id: patientId, clinicId: ctx.clinicId },
    select: { id: true },
  });
  if (!patient) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  if (invoiceId) {
    const invoice = await prisma.invoice.findFirst({
      where:  { id: invoiceId, clinicId: ctx.clinicId },
      select: { id: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
    }
  }

  const remaining    = totalAmount - (downPayment ?? 0);
  const baseInstall  = Math.round((remaining / installments) * 100) / 100;
  const freqDays     = frequency === "WEEKLY" ? 7 : frequency === "BIWEEKLY" ? 14 : 30;
  const start        = startDate ? new Date(startDate) : new Date();

  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.paymentPlan.create({
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

    const installmentData = Array.from({ length: installments }, (_, i) => {
      const dueDate = new Date(start);
      dueDate.setDate(dueDate.getDate() + freqDays * (i + 1));
      const amount = i === installments - 1
        ? Math.round((remaining - baseInstall * (installments - 1)) * 100) / 100
        : baseInstall;
      return { planId: created.id, installment: i + 1, amount, dueDate };
    });

    await tx.planPayment.createMany({ data: installmentData });
    return created;
  });

  const result = await prisma.paymentPlan.findUnique({
    where:   { id: plan.id },
    include: { payments: { orderBy: { installment: "asc" } } },
  });

  return NextResponse.json(result, { status: 201 });
}
