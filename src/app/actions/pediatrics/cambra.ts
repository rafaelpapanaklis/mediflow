"use server";
// Pediatrics — server actions para CariesRiskAssessment (CAMBRA). Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { scoreCambra } from "@/lib/pediatrics/cambra";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";

const cambraSchema = z.object({
  patientId: z.string().min(1),
  riskFactors: z.array(z.string()),
  protectiveFactors: z.array(z.string()),
  diseaseIndicators: z.array(z.string()),
});

export type CaptureCambraInput = z.infer<typeof cambraSchema>;

export async function captureCambra(input: CaptureCambraInput): Promise<ActionResult<{ id: string; category: string; recallMonths: number }>> {
  const parsed = cambraSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const result = scoreCambra({
    riskFactors: parsed.data.riskFactors,
    protectiveFactors: parsed.data.protectiveFactors,
    diseaseIndicators: parsed.data.diseaseIndicators,
  });

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const previous = await prisma.cariesRiskAssessment.findFirst({
    where: { patientId: parsed.data.patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { scoredAt: "desc" },
    select: { category: true },
  });

  const nextDueAt = new Date();
  nextDueAt.setMonth(nextDueAt.getMonth() + result.recallMonths);

  const created = await prisma.cariesRiskAssessment.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      scoredBy: ctx.userId,
      riskFactors: parsed.data.riskFactors,
      protectiveFactors: parsed.data.protectiveFactors,
      diseaseIndicators: parsed.data.diseaseIndicators,
      category: result.category,
      recommendedRecallMonths: result.recallMonths,
      previousCategory: previous?.category ?? null,
      nextDueAt,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.CAMBRA_CAPTURED,
    entityType: "ped-cambra",
    entityId: created.id,
    changes: { category: result.category, recallMonths: result.recallMonths },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok({ id: created.id, category: result.category, recallMonths: result.recallMonths });
}

export async function getCambraLatest(patientId: string): Promise<ActionResult<unknown>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const row = await prisma.cariesRiskAssessment.findFirst({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { scoredAt: "desc" },
  });
  return ok(row);
}

export async function getCambraHistory(patientId: string): Promise<ActionResult<unknown[]>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const rows = await prisma.cariesRiskAssessment.findMany({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { scoredAt: "desc" },
    take: 20,
  });
  return ok(rows);
}
