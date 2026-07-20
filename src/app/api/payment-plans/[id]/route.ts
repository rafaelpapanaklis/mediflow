import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { PLAN_STATUS } from "@/lib/payment-plans/status";
import { assertPatientVisible } from "@/lib/patient-visibility";

// PATCH /api/payment-plans/[id] — register a payment on an installment
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plan = await prisma.paymentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    include: { payments: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });

  // Visibilidad por paciente: no permitir registrar pagos (ni recibir el plan
  // con nombre del paciente) a quien no puede ver a ese paciente.
  if (plan.patientId) {
    const denied = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  const body = await req.json();
  const { installmentId, method, notes } = body;

  if (!installmentId) return NextResponse.json({ error: "installmentId requerido" }, { status: 400 });

  // Mark installment as paid — scoped to THIS plan (ya verificado por clínica)
  // para evitar IDOR cross-tenant: sin planId, un usuario podría marcar pagada
  // la cuota de OTRA clínica pasando su installmentId.
  const res = await prisma.planPayment.updateMany({
    where: { id: installmentId, planId: params.id },
    data:  { paidAt: new Date(), method: method ?? null, notes: notes ?? null },
  });
  if (res.count === 0) return NextResponse.json({ error: "Cuota no encontrada" }, { status: 404 });

  // Check if all installments are paid → complete the plan
  const updated = await prisma.planPayment.findMany({ where: { planId: params.id } });
  const allPaid = updated.every(p => p.paidAt !== null);

  if (allPaid) {
    await prisma.paymentPlan.update({
      where: { id: params.id },
      data:  { status: PLAN_STATUS.COMPLETED },
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

  // Visibilidad por paciente: no permitir cancelar el plan de un paciente que
  // este usuario no puede ver.
  if (plan.patientId) {
    const denied = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }

  await prisma.paymentPlan.updateMany({ where: { id: params.id, clinicId: ctx.clinicId }, data: { status: PLAN_STATUS.CANCELLED } });
  return NextResponse.json({ success: true });
}
