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

const methodEnum = z.enum(["tarjeta", "transfer", "efectivo", "msi"]);

const inputSchema = z.object({
  treatmentPlanId: z.string().uuid(),
  installmentId: z.string().uuid().optional(),
  method: methodEnum,
});

const METHOD_DB_MAP: Record<z.infer<typeof methodEnum>, string> = {
  tarjeta: "CARD",
  transfer: "TRANSFER",
  efectivo: "CASH",
  msi: "MSI",
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
  let installment = parsed.data.installmentId
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

  try {
    await prisma.orthoInstallment.update({
      where: { id: installment.id },
      data: { status: "PAID", paidAt: new Date() },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.COLLECT_RECORDED,
      entityType: "OrthoInstallment",
      entityId: installment.id,
      after: { method: METHOD_DB_MAP[parsed.data.method], amount: Number(installment.amount) },
    });

    // TODO: Stripe MX → cargo real con CARD y MSI. Facturapi → timbrar CFDI
    // 4.0 al confirmar pago. Ambos requieren STRIPE_SECRET_KEY_MX y
    // FACTURAPI_KEY en Vercel env vars; mientras tanto el cobro queda como
    // PAID local sin pasarela ni timbre.
    console.warn(
      "[ortho] confirmCollect: stub Stripe/Facturapi pendientes. Installment",
      installment.id,
    );

    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    return ok({ installmentId: installment.id, cfdiTimbradoStub: true });
  } catch (e) {
    console.error("[ortho] confirmCollect failed:", e);
    return fail("No se pudo registrar el cobro");
  }
}
