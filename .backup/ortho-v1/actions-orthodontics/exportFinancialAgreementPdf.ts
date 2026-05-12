"use server";
// Orthodontics — action 15/15: exportFinancialAgreementPdf. SPEC §9.2.

import { prisma } from "@/lib/prisma";
import { exportFinancialAgreementPdfSchema } from "@/lib/validation/orthodontics";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export type FinancialAgreementPdfData = {
  paymentPlanId: string;
  patient: { firstName: string; lastName: string };
  clinic: { name: string };
  technique: string;
  estimatedDurationMonths: number;
  totalAmount: string;
  initialDownPayment: string;
  installmentAmount: string;
  installmentCount: number;
  paymentDayOfMonth: number;
  startDate: string;
  endDate: string;
  preferredPaymentMethod: string;
  installments: Array<{
    installmentNumber: number;
    dueDate: string;
    amount: string;
    status: string;
  }>;
  generatedAt: string;
};

export async function exportFinancialAgreementPdf(
  input: unknown,
): Promise<ActionResult<FinancialAgreementPdfData>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = exportFinancialAgreementPdfSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthoPaymentPlan.findFirst({
    where: { id: parsed.data.paymentPlanId, clinicId: ctx.clinicId },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      treatmentPlan: { select: { technique: true, estimatedDurationMonths: true } },
      installments: { orderBy: { installmentNumber: "asc" } },
    },
  });
  if (!plan) return fail("Plan de pagos no encontrado");

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { name: true },
  });
  if (!clinic) return fail("Clínica no encontrada");

  await auditOrtho({
    ctx,
    action: ORTHO_AUDIT_ACTIONS.REPORT_FINANCIAL_AGREEMENT_PDF,
    entityType: "OrthoPaymentPlan",
    entityId: plan.id,
    meta: { exportedAt: new Date().toISOString() },
  });

  return ok({
    paymentPlanId: plan.id,
    patient: plan.patient,
    clinic,
    technique: plan.treatmentPlan.technique,
    estimatedDurationMonths: plan.treatmentPlan.estimatedDurationMonths,
    totalAmount: plan.totalAmount.toString(),
    initialDownPayment: plan.initialDownPayment.toString(),
    installmentAmount: plan.installmentAmount.toString(),
    installmentCount: plan.installmentCount,
    paymentDayOfMonth: plan.paymentDayOfMonth,
    startDate: plan.startDate.toISOString(),
    endDate: plan.endDate.toISOString(),
    preferredPaymentMethod: plan.preferredPaymentMethod,
    installments: plan.installments.map((i) => ({
      installmentNumber: i.installmentNumber,
      dueDate: i.dueDate.toISOString(),
      amount: i.amount.toString(),
      status: i.status,
    })),
    generatedAt: new Date().toISOString(),
  });
}
