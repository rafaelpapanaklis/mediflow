"use server";
// Orthodontics — updateFinancialPlan. Permite a la clínica modificar el
// plan financiero de un tratamiento ortodóntico:
//   - precio total (totalAmount)
//   - enganche (initialDownPayment)
//   - número de meses / installments (installmentCount)
//
// Recalcula installmentAmount + recrea installments PENDING (preserva PAID
// + sus paidAt/cfdi). Audit log con before/after para trazabilidad.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  totalAmount: z.number().positive().max(500_000),
  initialDownPayment: z.number().nonnegative().max(500_000),
  /** 3, 6, 12, 18, 24 — o cualquier valor entre 1 y 60. */
  installmentCount: z.number().int().min(1).max(60),
  /** Día del mes para pagos (1-28). Default 14. */
  paymentDayOfMonth: z.number().int().min(1).max(28).default(14),
});

export async function updateFinancialPlan(
  input: unknown,
): Promise<
  ActionResult<{
    paymentPlanId: string;
    installmentAmount: number;
    installmentCount: number;
    paidPreserved: number;
  }>
> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  const data = parsed.data;

  if (data.initialDownPayment >= data.totalAmount) {
    return fail("El enganche no puede ser mayor o igual al total");
  }

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  const paymentPlan = await prisma.orthoPaymentPlan.findFirst({
    where: { treatmentPlanId: plan.id, clinicId: ctx.clinicId },
    select: {
      id: true,
      totalAmount: true,
      initialDownPayment: true,
      installmentCount: true,
      installmentAmount: true,
      paidAmount: true,
      pendingAmount: true,
      preferredPaymentMethod: true,
    },
  });
  if (!paymentPlan)
    return fail("PaymentPlan no encontrado para este tratamiento");

  // installmentAmount = (total - enganche) / count, redondeado a entero.
  // El último installment absorbe el remanente para que la suma exacta
  // matchee total - enganche.
  const remaining = data.totalAmount - data.initialDownPayment;
  const baseInstallment = Math.round(remaining / data.installmentCount);

  // Existing PAID installments NUNCA se borran. Recrear PENDING/OVERDUE/FUTURE
  // basándose en el nuevo plan.
  const existing = await prisma.orthoInstallment.findMany({
    where: { paymentPlanId: paymentPlan.id },
    orderBy: { installmentNumber: "asc" },
  });
  const paidPreserved = existing.filter((i) => i.status === "PAID").length;

  if (paidPreserved > data.installmentCount) {
    return fail(
      `No se puede reducir installments a ${data.installmentCount}: ya hay ${paidPreserved} pagadas`,
    );
  }

  // Calculate due dates: PAID keep their dueDate; non-PAID get fresh dates
  // starting from PaymentPlan.startDate + (i-1) months on paymentDayOfMonth.
  const startDate = await prisma.orthoPaymentPlan
    .findUnique({
      where: { id: paymentPlan.id },
      select: { startDate: true },
    })
    .then((p) => p?.startDate ?? new Date());

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update plan totals
      await tx.orthoPaymentPlan.update({
        where: { id: paymentPlan.id },
        data: {
          totalAmount: data.totalAmount,
          initialDownPayment: data.initialDownPayment,
          installmentCount: data.installmentCount,
          installmentAmount: baseInstallment,
          paymentDayOfMonth: data.paymentDayOfMonth,
        },
      });

      // 2. Delete existing PENDING/OVERDUE/FUTURE installments (NOT PAID).
      await tx.orthoInstallment.deleteMany({
        where: {
          paymentPlanId: paymentPlan.id,
          status: { in: ["PENDING", "OVERDUE", "WAIVED"] },
        },
      });

      // 3. Recreate from #(paidPreserved+1) to #installmentCount.
      // El último installment absorbe el remanente.
      const totalInstallmentSum = baseInstallment * data.installmentCount;
      const drift = remaining - totalInstallmentSum; // positivo o negativo
      for (let n = paidPreserved + 1; n <= data.installmentCount; n++) {
        const due = new Date(startDate);
        due.setMonth(due.getMonth() + (n - 1));
        due.setDate(data.paymentDayOfMonth);
        const isLast = n === data.installmentCount;
        const amount = isLast ? baseInstallment + drift : baseInstallment;
        await tx.orthoInstallment.create({
          data: {
            paymentPlanId: paymentPlan.id,
            clinicId: ctx.clinicId,
            installmentNumber: n,
            amount,
            dueDate: due,
            status: "PENDING",
          },
        });
      }

      // 4. Recalcular paidAmount + pendingAmount.
      const all = await tx.orthoInstallment.findMany({
        where: { paymentPlanId: paymentPlan.id },
        select: { amount: true, status: true },
      });
      const paidSum = all
        .filter((i) => i.status === "PAID")
        .reduce((a, i) => a + Number(i.amount), 0);
      const pendingSum = all
        .filter((i) => i.status === "PENDING" || i.status === "OVERDUE")
        .reduce((a, i) => a + Number(i.amount), 0);
      await tx.orthoPaymentPlan.update({
        where: { id: paymentPlan.id },
        data: { paidAmount: paidSum, pendingAmount: pendingSum },
      });

      // 5. Sync OrthodonticTreatmentPlan.totalCostMxn
      await tx.orthodonticTreatmentPlan.update({
        where: { id: plan.id },
        data: { totalCostMxn: data.totalAmount },
      });

      return { paymentPlanId: paymentPlan.id, paidSum, pendingSum };
    });

    await auditOrtho({
      ctx,
      action: "ortho.financialPlan.updated",
      entityType: "OrthoPaymentPlan",
      entityId: paymentPlan.id,
      before: {
        totalAmount: Number(paymentPlan.totalAmount),
        installmentCount: paymentPlan.installmentCount,
        installmentAmount: Number(paymentPlan.installmentAmount),
        initialDownPayment: Number(paymentPlan.initialDownPayment),
      },
      after: {
        totalAmount: data.totalAmount,
        installmentCount: data.installmentCount,
        installmentAmount: baseInstallment,
        initialDownPayment: data.initialDownPayment,
      },
    });

    try {
      revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
      revalidatePath(`/dashboard/patients/${plan.patientId}`);
    } catch (e) {
      console.error("[ortho] updateFinancialPlan · revalidatePath failed:", e);
    }

    return ok({
      paymentPlanId: result.paymentPlanId,
      installmentAmount: baseInstallment,
      installmentCount: data.installmentCount,
      paidPreserved,
    });
  } catch (e) {
    console.error("[ortho] updateFinancialPlan failed:", e);
    return fail(
      e instanceof Error
        ? `No se pudo actualizar el plan financiero: ${e.message}`
        : "No se pudo actualizar el plan financiero",
    );
  }
}
