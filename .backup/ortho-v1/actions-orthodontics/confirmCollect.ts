"use server";
// Orthodontics — confirmCollect. ModalCollect M1: registra cobro de la
// siguiente mensualidad pendiente. Stripe MX / Facturapi son TODO —
// por ahora marcamos PAID y registramos el método.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";
import type { OrthoPaymentMethod } from "@prisma/client";

const methodEnum = z.enum(["tarjeta", "transfer", "efectivo", "msi"]);

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  installmentId: z.string().uuid().optional(),
  method: methodEnum,
});

// Mapeo de método UI → enum OrthoPaymentMethod (Prisma).
// Bug histórico: el map previo apuntaba a strings que NO existen en el
// enum (CARD/TRANSFER/MSI) → si en algún flow se persistía, Prisma lanzaba
// "Invalid enum value" y la action devolvía el genérico "No se pudo
// registrar el cobro". Fix: enum-safe + persiste el método en la columna.
const METHOD_TO_PRISMA: Record<z.infer<typeof methodEnum>, OrthoPaymentMethod> = {
  tarjeta: "DEBIT_CARD",
  transfer: "BANK_TRANSFER",
  efectivo: "CASH",
  // MSI se modela como CREDIT_CARD (msi = meses sin intereses sobre
  // tarjeta de crédito); el detalle MSI vive en spec del audit.
  msi: "CREDIT_CARD",
};

export async function confirmCollect(
  input: unknown,
): Promise<ActionResult<{ installmentId: string; cfdiTimbradoStub: boolean }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true },
  });
  if (!plan) return fail("Plan no encontrado");

  // Resolver installment: el explícito o el siguiente PENDING.
  const installment = parsed.data.installmentId
    ? await prisma.orthoInstallment.findFirst({
        where: {
          id: parsed.data.installmentId,
          paymentPlan: { treatmentPlanId: plan.id, clinicId: ctx.clinicId },
        },
        select: { id: true, status: true, amount: true, installmentNumber: true },
      })
    : await prisma.orthoInstallment.findFirst({
        where: {
          paymentPlan: { treatmentPlanId: plan.id, clinicId: ctx.clinicId },
          status: "PENDING",
        },
        orderBy: { installmentNumber: "asc" },
        select: { id: true, status: true, amount: true, installmentNumber: true },
      });

  if (!installment) return fail("No hay mensualidad pendiente que cobrar");
  if (installment.status === "PAID") return fail("Esta mensualidad ya está pagada");

  const paymentMethod = METHOD_TO_PRISMA[parsed.data.method];
  const amountAsNumber = Number(installment.amount);

  try {
    // Persiste TODO el contexto del cobro: status + paidAt + amountPaid +
    // paymentMethod + recordedById. Antes solo escribía status + paidAt y
    // dejaba paymentMethod NULL — auditoría incompleta.
    await prisma.orthoInstallment.update({
      where: { id: installment.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        amountPaid: amountAsNumber,
        paymentMethod,
        recordedById: ctx.userId,
      },
    });
  } catch (e) {
    console.error("[ortho] confirmCollect · update failed:", e);
    return fail(
      e instanceof Error
        ? `No se pudo registrar el cobro: ${e.message}`
        : "No se pudo registrar el cobro",
    );
  }

  // Recalcular OrthoPaymentPlan.paidAmount + pendingAmount + status.
  // Si esto falla, el cobro YA quedó persistido → no revertimos, solo
  // logueamos y avanzamos. La inconsistencia se corrige con el cron de
  // recalculatePaymentStatus.
  try {
    const installments = await prisma.orthoInstallment.findMany({
      where: {
        paymentPlan: { treatmentPlanId: plan.id, clinicId: ctx.clinicId },
      },
      select: { amount: true, status: true },
    });
    const totalPaid = installments
      .filter((i) => i.status === "PAID")
      .reduce((a, i) => a + Number(i.amount), 0);
    const totalPending = installments
      .filter((i) => i.status === "PENDING" || i.status === "OVERDUE")
      .reduce((a, i) => a + Number(i.amount), 0);
    await prisma.orthoPaymentPlan.updateMany({
      where: { treatmentPlanId: plan.id, clinicId: ctx.clinicId },
      data: { paidAmount: totalPaid, pendingAmount: totalPending },
    });
  } catch (e) {
    console.error("[ortho] confirmCollect · recalc payment plan failed (non-fatal):", e);
  }

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.COLLECT_RECORDED,
    entityType: "OrthoInstallment",
    entityId: installment.id,
    after: {
      method: paymentMethod,
      amount: amountAsNumber,
      uiMethod: parsed.data.method,
      installmentNumber: installment.installmentNumber,
    },
  });

  // TODO: Stripe MX → cargo real con CARD y MSI. Facturapi → timbrar CFDI
  // 4.0 al confirmar pago. Ambos requieren STRIPE_SECRET_KEY_MX y
  // FACTURAPI_KEY en Vercel env vars; mientras tanto el cobro queda como
  // PAID local sin pasarela ni timbre.
  console.warn(
    "[ortho] confirmCollect: stub Stripe/Facturapi pendientes. Installment",
    installment.id,
  );

  // revalidatePath puede fallar si la ruta no existe o tiene errores
  // runtime — no debe tumbar el cobro. Try/catch defensivo.
  try {
    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    revalidatePath(`/dashboard/patients/${plan.patientId}`);
  } catch (e) {
    console.error("[ortho] confirmCollect · revalidatePath failed (non-fatal):", e);
  }

  return ok({ installmentId: installment.id, cfdiTimbradoStub: true });
}
