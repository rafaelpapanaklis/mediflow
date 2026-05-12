"use server";

// Financial · 5 server actions (SPEC §1.3 FINANCIAL).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { FinancialPlan, Installment } from "@prisma/client";
import { FinancialPlanInputSchema } from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";

export async function upsertFinancialPlan(input: {
  caseId: string;
  total: number;
  downPayment: number;
  months: number;
  monthly: number;
  startDate: Date;
  scenarios?: unknown[];
}): Promise<Result<FinancialPlan>> {
  const parsed = FinancialPlanInputSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("edit_financial_plan");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  const plan = await prisma.financialPlan.upsert({
    where: { caseId: input.caseId },
    create: {
      caseId: input.caseId,
      total: parsed.data.total,
      downPayment: parsed.data.downPayment,
      months: parsed.data.months,
      monthly: parsed.data.monthly,
      startDate: parsed.data.startDate,
      scenarios: (input.scenarios ?? []) as never,
    },
    update: {
      total: parsed.data.total,
      downPayment: parsed.data.downPayment,
      months: parsed.data.months,
      monthly: parsed.data.monthly,
      startDate: parsed.data.startDate,
      scenarios: (input.scenarios ?? []) as never,
    },
  });
  return ok(plan);
}

export async function setActiveScenario(input: {
  planId: string;
  scenarioId: string;
}): Promise<Result<FinancialPlan>> {
  const auth = await requirePermission("activate_scenario_signathome");
  if (!auth.ok) return reFail(auth);
  const plan = await prisma.financialPlan.findUnique({
    where: { id: input.planId },
    select: { id: true, case: { select: { clinicId: true } } },
  });
  if (!plan || plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plan financiero no encontrado");
  const updated = await prisma.financialPlan.update({
    where: { id: input.planId },
    data: { activeScenarioId: input.scenarioId },
  });
  return ok(updated);
}

export async function regenerateInstallments(
  planId: string,
): Promise<Result<Installment[]>> {
  const auth = await requirePermission("edit_financial_plan");
  if (!auth.ok) return reFail(auth);
  const plan = await prisma.financialPlan.findUnique({
    where: { id: planId },
    select: {
      id: true,
      months: true,
      monthly: true,
      startDate: true,
      case: { select: { clinicId: true } },
    },
  });
  if (!plan || plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plan financiero no encontrado");

  await prisma.installment.deleteMany({
    where: { financialId: planId, status: "FUTURE" },
  });

  const start = new Date(plan.startDate);
  const installments = await prisma.$transaction(
    Array.from({ length: plan.months }, (_, i) => {
      const dueDate = new Date(start);
      dueDate.setMonth(dueDate.getMonth() + i);
      return prisma.installment.upsert({
        where: {
          financialId_number: { financialId: planId, number: i + 1 },
        },
        create: {
          financialId: planId,
          number: i + 1,
          amount: plan.monthly,
          dueDate,
          status: "FUTURE",
        },
        update: {
          amount: plan.monthly,
          dueDate,
        },
      });
    }),
  );
  return ok(installments);
}

export async function collectInstallment(input: {
  installmentId: string;
  paymentMethod: string;
}): Promise<Result<{ installment: Installment }>> {
  const auth = await requirePermission("collect_installment");
  if (!auth.ok) return reFail(auth);
  const inst = await prisma.installment.findUnique({
    where: { id: input.installmentId },
    include: { financial: { select: { case: { select: { clinicId: true } } } } },
  });
  if (!inst || inst.financial.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Mensualidad no encontrada");
  if (inst.status === "PAID")
    return fail("conflict", "Mensualidad ya pagada");

  // CFDI Facturapi · stub Fase 2 — solo marca como PAID, sin timbrar.
  // Stripe MX cobro tokenizado para CARD/MSI · stub Fase 2.
  // Twilio para envío de recibo · stub Fase 2.
  const installment = await prisma.installment.update({
    where: { id: input.installmentId },
    data: { status: "PAID", paidAt: new Date() },
  });
  return ok({ installment });
}

export async function sendSignAtHome(input: {
  planId: string;
  scenarioId: string;
}): Promise<Result<{ externalId: string }>> {
  const auth = await requirePermission("activate_scenario_signathome");
  if (!auth.ok) return reFail(auth);
  const plan = await prisma.financialPlan.findUnique({
    where: { id: input.planId },
    select: { id: true, case: { select: { clinicId: true } } },
  });
  if (!plan || plan.case.clinicId !== auth.data.clinicId)
    return fail("not_found", "Plan financiero no encontrado");

  // Twilio para envío WhatsApp · stub Fase 2 (servicio externo autorizado).
  // Stripe MX para flujo "cobrar al firmar" · stub Fase 2.
  const externalId = `sah_${Date.now().toString(36)}`;
  await prisma.financialPlan.update({
    where: { id: input.planId },
    data: {
      activeScenarioId: input.scenarioId,
      signAtHomeUrl: `https://mediflow.mx/sign/${externalId}`,
    },
  });
  return ok({ externalId });
}
