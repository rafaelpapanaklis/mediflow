"use server";
// Orthodontics — action 6/15: createPaymentPlan + N installments en transacción. SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createPaymentPlanSchema } from "@/lib/validation/orthodontics";
import {
  auditOrtho,
  getOrthoActionContext,
  loadPatientForOrtho,
} from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createPaymentPlan(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createPaymentPlanSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForOrtho({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: {
      id: parsed.data.treatmentPlanId,
      clinicId: ctx.clinicId,
      deletedAt: null,
    },
    include: { paymentPlan: { select: { id: true } } },
  });
  if (!plan) return fail("Plan de tratamiento no encontrado");
  if (plan.paymentPlan) {
    return fail("El plan ya tiene un acuerdo de pagos", plan.paymentPlan.id);
  }

  // Validación SPEC §4.5: enganche + (cuotas × N) >= total con margen 1%.
  const totalCommitted =
    parsed.data.initialDownPayment + parsed.data.installmentAmount * parsed.data.installmentCount;
  if (totalCommitted < parsed.data.totalAmount * 0.99) {
    return fail(
      "La suma de enganche + mensualidades no cubre el total (margen 1% para redondeo).",
    );
  }

  const startDate = new Date(parsed.data.startDate);
  const totalPending =
    parsed.data.installmentAmount * parsed.data.installmentCount; // sin contar enganche

  try {
    const created = await prisma.$transaction(async (tx) => {
      // endDate = startDate + (installmentCount-1) meses (último vencimiento).
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + parsed.data.installmentCount - 1);

      const paymentPlan = await tx.orthoPaymentPlan.create({
        data: {
          treatmentPlanId: parsed.data.treatmentPlanId,
          patientId: parsed.data.patientId,
          clinicId: ctx.clinicId,
          totalAmount: parsed.data.totalAmount,
          initialDownPayment: parsed.data.initialDownPayment,
          installmentAmount: parsed.data.installmentAmount,
          installmentCount: parsed.data.installmentCount,
          startDate,
          endDate,
          paymentDayOfMonth: parsed.data.paymentDayOfMonth,
          paidAmount: parsed.data.initialDownPayment,
          pendingAmount: totalPending,
          status: "ON_TIME",
          preferredPaymentMethod: parsed.data.preferredPaymentMethod,
          signedFinancialAgreementFileId: parsed.data.signedFinancialAgreementFileId ?? null,
          notes: parsed.data.notes ?? null,
        },
      });

      for (let i = 1; i <= parsed.data.installmentCount; i++) {
        const dueDate = new Date(startDate);
        dueDate.setMonth(dueDate.getMonth() + (i - 1));
        // Ajusta al paymentDayOfMonth (clamp 1-28 ya validado).
        dueDate.setDate(parsed.data.paymentDayOfMonth);
        await tx.orthoInstallment.create({
          data: {
            paymentPlanId: paymentPlan.id,
            clinicId: ctx.clinicId,
            installmentNumber: i,
            amount: parsed.data.installmentAmount,
            dueDate,
            status: "PENDING",
          },
        });
      }

      return paymentPlan;
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.PAYMENT_PLAN_CREATED,
      entityType: "OrthoPaymentPlan",
      entityId: created.id,
      after: {
        totalAmount: created.totalAmount.toString(),
        installments: parsed.data.installmentCount,
        downPayment: created.initialDownPayment.toString(),
      },
    });

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: created.id });
  } catch (e) {
    console.error("[ortho] createPaymentPlan failed:", e);
    return fail("No se pudo crear el acuerdo de pagos");
  }
}
