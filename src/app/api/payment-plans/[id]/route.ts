import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

// PATCH /api/payment-plans/[id] — register a payment on an installment
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await prisma.paymentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: { payments: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  const body = await req.json();
  const { installmentId, method, notes } = body;

  if (!installmentId) return NextResponse.json({ error: "installmentId requerido" }, { status: 400 });

  // Mark installment as paid
  await prisma.planPayment.update({
    where: { id: installmentId },
    data:  { paidAt: new Date(), method: method ?? null, notes: notes ?? null },
  });

  // Check if all installments are paid → complete the plan
  const updated = await prisma.planPayment.findMany({ where: { planId: params.id } });
  const allPaid = updated.every(p => p.paidAt !== null);

  if (allPaid) {
    await prisma.paymentPlan.update({
      where: { id: params.id },
      data:  { status: "COMPLETED" },
    });
  }

  const result = await prisma.paymentPlan.findUnique({
    where:   { id: params.id },
    include: { payments: { orderBy: { installment: "asc" } }, patient: { select: { firstName: true, lastName: true } } },
  });

  return NextResponse.json(result);
}

// DELETE /api/payment-plans/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await prisma.paymentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  await prisma.paymentPlan.updateMany({ where: { id: params.id, clinicId: ctx.clinicId }, data: { status: "CANCELLED" } });
  return NextResponse.json({ success: true });
}
