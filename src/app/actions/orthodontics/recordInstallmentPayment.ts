"use server";
// Orthodontics — action 7/15: recordInstallmentPayment con backdating ±60d. SPEC §1.12 + §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recordInstallmentPaymentSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

const SIXTY_DAYS_MS = 60 * 86_400_000;

export async function recordInstallmentPayment(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = recordInstallmentPaymentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const installment = await prisma.orthoInstallment.findFirst({
    where: { id: parsed.data.installmentId, clinicId: ctx.clinicId },
    include: {
      paymentPlan: {
        select: { id: true, patientId: true, treatmentPlanId: true, installmentAmount: true },
      },
    },
  });
  if (!installment) return fail("Mensualidad no encontrada");
  if (installment.status === "PAID") return fail("La mensualidad ya está pagada");
  if (installment.status === "WAIVED") return fail("La mensualidad fue perdonada");

  const paidAt = new Date(parsed.data.paidAt);
  const now = new Date();

  // Validar rango paidAt en [dueDate - 60d, now()]. SPEC §1.12.
  const minPaidAt = new Date(installment.dueDate.getTime() - SIXTY_DAYS_MS);
  const isOutOfRange = paidAt < minPaidAt || paidAt > now;
  if (isOutOfRange) {
    if (
      !parsed.data.backdatingJustification ||
      parsed.data.backdatingJustification.trim().length < 20
    ) {
      return fail(
        "paidAt fuera del rango [dueDate - 60d, ahora]. Requiere backdatingJustification ≥20 caracteres.",
      );
    }
  }

  // Validar amountPaid ±5% del installmentAmount esperado (sin justificación dedicada
  // en este MVP — toleramos diferencia chica por descuento por pronto pago).
  const expected = Number(installment.amount);
  const lowerBound = expected * 0.95;
  const upperBound = expected * 1.05;
  if (parsed.data.amountPaid < lowerBound || parsed.data.amountPaid > upperBound) {
    return fail(
      `amountPaid fuera de ±5% del monto esperado (${expected}). Use waiver si quieres perdonar diferencia.`,
    );
  }

  try {
    const updated = await prisma.orthoInstallment.update({
      where: { id: installment.id },
      data: {
        status: "PAID",
        paidAt,
        amountPaid: parsed.data.amountPaid,
        paymentMethod: parsed.data.paymentMethod,
        receiptFileId: parsed.data.receiptFileId ?? null,
        recordedById: ctx.userId,
        backdatingJustification: isOutOfRange
          ? parsed.data.backdatingJustification ?? null
          : null,
      },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.INSTALLMENT_PAID,
      entityType: "OrthoInstallment",
      entityId: updated.id,
      after: {
        installmentNumber: updated.installmentNumber,
        amountPaid: updated.amountPaid?.toString() ?? null,
        paymentMethod: updated.paymentMethod,
        backdatingJustification: updated.backdatingJustification,
        outOfRange: isOutOfRange,
      },
    });

    // El trigger SQL recalc_payment_plan_status ya recalcula el plan. Sin embargo
    // notificamos al cliente con revalidatePath. La defensa adicional (action
    // recalculatePaymentStatus) está disponible como botón manual.
    revalidatePath(`/dashboard/patients/${installment.paymentPlan.patientId}/orthodontics`);
    revalidatePath(
      `/dashboard/specialties/orthodontics/${installment.paymentPlan.patientId}`,
    );
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: updated.id });
  } catch (e) {
    console.error("[ortho] recordInstallmentPayment failed:", e);
    return fail("No se pudo registrar el pago");
  }
}
