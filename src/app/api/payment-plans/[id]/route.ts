import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { PLAN_STATUS } from "@/lib/payment-plans/status";
import { assertPatientVisible } from "@/lib/patient-visibility";
import { denyIfMissingPermission } from "@/lib/auth/require-permission";
import { logMutation } from "@/lib/audit";

// PATCH /api/payment-plans/[id] — RETIRADO (ws1-t5, F13 de la auditoría del dinero).
//
// Marcaba una cuota como cobrada en `plan_payments` (paidAt, método) SIN crear
// un Payment: ese dinero no entraba a Caja, ni al corte, ni a Finanzas. Ninguna
// pantalla lo llamaba. Ahora contesta 410 sin escribir nada; los cobros van por
// el cobro normal de la factura (POST /api/invoices/[id]). Se conservan la
// sesión, el permiso, la clínica y la visibilidad: nadie de fuera aprende nada.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const deniedPerm = denyIfMissingPermission(ctx, "billing.charge");
  if (deniedPerm) return deniedPerm;

  const plan = await prisma.paymentPlan.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
    select: { patientId: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan no encontrado" }, { status: 404 });
  if (plan.patientId) {
    const denied = await assertPatientVisible(plan.patientId, { userId: ctx.userId, role: ctx.role, clinicId: ctx.clinicId });
    if (denied) return denied;
  }
  return NextResponse.json({
    error: "Este registro de pagos ya no se usa: cobra con el cobro normal de la factura (Caja o la ficha del paciente) para que el dinero entre al corte y a los reportes.",
    code: "COBRO_VIEJO_RETIRADO",
  }, { status: 410 });
}

// DELETE /api/payment-plans/[id]
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Misma key que el PATCH: cancelar el plan es la otra mitad de operarlo —
  // deja de cobrarse el resto de las cuotas. Una sola llave para toda la
  // superficie de escritura del módulo, mismo criterio con el que el PR #190
  // le dio a DELETE /api/quotes/[id] la key de su PATCH.
  const deniedPerm = denyIfMissingPermission(ctx, "billing.charge");
  if (deniedPerm) return deniedPerm;

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

  // P4 — bitácora: cancelar un plan detiene el cobro de todo lo que falte;
  // "void" (no borra la fila, invalida el plan — hallazgo REPORTE-ws1-t8.md).
  await logMutation({
    patientId: plan.patientId,
    texto: "Canceló un plan de pagos",
    req,
    clinicId: ctx.clinicId,
    userId: ctx.userId,
    entityType: "payment-plan",
    entityId: params.id,
    action: "void",
    before: { status: plan.status },
    after: { status: PLAN_STATUS.CANCELLED },
  });

  return NextResponse.json({ success: true });
}
