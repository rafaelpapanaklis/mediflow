"use server";
// Orthodontics — action 8/15: recalculatePaymentStatus. SPEC §5.2.
//
// Idempotente. Recalcula paidAmount/pendingAmount/status del plan a partir
// de los installments. El trigger SQL hace lo mismo automáticamente, esta
// action existe como defensa primaria + botón manual "Recalcular ahora"
// + para que el cron Vercel la invoque (F8).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recalculatePaymentStatusSchema } from "@/lib/validation/orthodontics";
import { computePaymentStatus } from "@/lib/orthodontics/payment-status";
import { enqueueOrthoWhatsApp } from "@/lib/orthodontics/whatsapp-queue";
import type { OrthoWhatsAppTemplateKey } from "@/lib/orthodontics/whatsapp-templates";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function recalculatePaymentStatus(
  input: unknown,
): Promise<
  ActionResult<{
    id: string;
    status: "ON_TIME" | "LIGHT_DELAY" | "SEVERE_DELAY" | "PAID_IN_FULL";
    paidAmount: number;
    pendingAmount: number;
  }>
> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = recalculatePaymentStatusSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthoPaymentPlan.findFirst({
    where: { id: parsed.data.paymentPlanId, clinicId: ctx.clinicId },
    include: {
      installments: {
        select: { amount: true, dueDate: true, status: true, paidAt: true, amountPaid: true },
      },
    },
  });
  if (!plan) return fail("Plan de pagos no encontrado");

  const totalPaidFromInstallments = plan.installments.reduce((sum, i) => {
    if (i.status === "PAID" && i.amountPaid) return sum + Number(i.amountPaid);
    if (i.status === "WAIVED") return sum + Number(i.amount);
    return sum;
  }, 0);
  const newPaidAmount = totalPaidFromInstallments + Number(plan.initialDownPayment);
  const newPendingAmount = Math.max(Number(plan.totalAmount) - newPaidAmount, 0);

  const statusResult = computePaymentStatus(
    plan.installments.map((i) => ({
      amount: Number(i.amount),
      dueDate: i.dueDate,
      status: i.status,
      paidAt: i.paidAt,
    })),
  );

  try {
    const updated = await prisma.orthoPaymentPlan.update({
      where: { id: plan.id },
      data: {
        paidAmount: newPaidAmount,
        pendingAmount: newPendingAmount,
        status: statusResult.status,
        statusUpdatedAt: new Date(),
      },
    });

    if (plan.status !== statusResult.status) {
      await auditOrtho({
        ctx,
        action: ORTHO_AUDIT_ACTIONS.PAYMENT_STATUS_RECALCULATED,
        entityType: "OrthoPaymentPlan",
        entityId: updated.id,
        before: { status: plan.status },
        after: { status: statusResult.status },
        meta: {
          paidAmount: newPaidAmount,
          pendingAmount: newPendingAmount,
          daysOverdue: statusResult.daysOverdue,
          amountOverdue: statusResult.amountOverdue,
        },
      });

      // ─── WhatsApp queue (F9.5) — encolar notificación al transitar a delay ──
      const transitionedToDelay =
        (plan.status !== "LIGHT_DELAY" && statusResult.status === "LIGHT_DELAY") ||
        (plan.status !== "SEVERE_DELAY" && statusResult.status === "SEVERE_DELAY");
      if (transitionedToDelay) {
        const templateKey: OrthoWhatsAppTemplateKey =
          statusResult.status === "SEVERE_DELAY"
            ? "INSTALLMENT_OVERDUE_SEVERE"
            : "INSTALLMENT_OVERDUE_LIGHT";
        const patient = await prisma.patient.findUnique({
          where: { id: updated.patientId },
          select: { phone: true },
        });
        if (patient?.phone) {
          await enqueueOrthoWhatsApp(prisma, {
            clinicId: ctx.clinicId,
            templateKey,
            scheduledFor: new Date(),
            patientPhone: patient.phone,
          }).catch((e) => {
            console.error("[ortho] WA enqueue (delay) failed (no bloquea):", e);
          });
        }
      }
    }

    revalidatePath(`/dashboard/patients/${updated.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${updated.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({
      id: updated.id,
      status: statusResult.status,
      paidAmount: newPaidAmount,
      pendingAmount: newPendingAmount,
    });
  } catch (e) {
    console.error("[ortho] recalculatePaymentStatus failed:", e);
    return fail("No se pudo recalcular el status");
  }
}
