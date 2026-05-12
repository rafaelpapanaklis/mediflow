"use server";

// Retention · 5 server actions (SPEC §1.3 RETENTION).

import { prisma } from "@/lib/prisma";
import { fail, ok, reFail, type Result } from "@/lib/orthodontics-v2/types";
import type { RetentionPlan, Appointment } from "@prisma/client";
import { RetentionInputSchema } from "@/lib/orthodontics-v2/schemas";
import { guardCase, requirePermission } from "./_auth";

export async function upsertRetentionPlan(input: {
  caseId: string;
  retUpper: unknown;
  retLower: unknown;
  fixedGauge?: string;
  regimen: string;
  checkpoints: Date[];
  referralCode: string;
  referralReward: { kind: string; label: string };
}): Promise<Result<RetentionPlan>> {
  const parsed = RetentionInputSchema.safeParse(input);
  if (!parsed.success)
    return fail("invalid_input", parsed.error.errors[0]?.message ?? "Datos inválidos");
  const auth = await requirePermission("edit_retention_regimen");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  const plan = await prisma.retentionPlan.upsert({
    where: { caseId: input.caseId },
    create: {
      caseId: input.caseId,
      retUpper: parsed.data.retUpper,
      retLower: parsed.data.retLower,
      fixedGauge: parsed.data.fixedGauge,
      regimen: parsed.data.regimen,
      checkpoints: parsed.data.checkpoints,
      checkpointsDone: {},
      referralCode: parsed.data.referralCode,
      referralReward: parsed.data.referralReward,
    },
    update: {
      retUpper: parsed.data.retUpper,
      retLower: parsed.data.retLower,
      fixedGauge: parsed.data.fixedGauge,
      regimen: parsed.data.regimen,
      checkpoints: parsed.data.checkpoints,
      referralCode: parsed.data.referralCode,
      referralReward: parsed.data.referralReward,
    },
  });
  return ok(plan);
}

export async function scheduleRetentionCheckpoint(input: {
  caseId: string;
  when: Date;
}): Promise<Result<Appointment>> {
  const auth = await requirePermission("schedule_retention_checkpoint");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);

  const c = await prisma.orthoCase.findUnique({
    where: { id: input.caseId },
    select: { patientId: true, primaryDoctorId: true },
  });
  if (!c) return fail("not_found", "Caso no encontrado");

  const endsAt = new Date(input.when);
  endsAt.setMinutes(endsAt.getMinutes() + 30);

  const appt = await prisma.appointment.create({
    data: {
      clinicId: auth.data.clinicId,
      patientId: c.patientId,
      doctorId: c.primaryDoctorId,
      type: "Control de retención",
      startsAt: input.when,
      endsAt,
      status: "PENDING",
      source: "STAFF",
    },
  });

  // También agregar al RetentionPlan.checkpoints
  await prisma.retentionPlan.update({
    where: { caseId: input.caseId },
    data: { checkpoints: { push: input.when } },
  });

  return ok(appt);
}

export async function recordNpsResponse(input: {
  caseId: string;
  checkpoint: string;
  score: number;
  comment?: string;
}): Promise<Result<RetentionPlan>> {
  const auth = await requirePermission("view_record");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, input.caseId);
  if (!g.ok) return reFail(g);
  if (input.score < 0 || input.score > 10)
    return fail("invalid_input", "Score debe estar entre 0 y 10", "score");

  const plan = await prisma.retentionPlan.findUnique({
    where: { caseId: input.caseId },
  });
  if (!plan) return fail("not_found", "Plan de retención no encontrado");

  const done = (plan.checkpointsDone as Record<string, unknown>) ?? {};
  done[input.checkpoint] = {
    doneAt: new Date().toISOString(),
    score: input.score,
    comment: input.comment,
  };

  const updated = await prisma.retentionPlan.update({
    where: { caseId: input.caseId },
    data: { checkpointsDone: done as never },
  });
  return ok(updated);
}

export async function generateBeforeAfterPdf(
  caseId: string,
): Promise<Result<{ url: string }>> {
  const auth = await requirePermission("generate_before_after_pdf");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, caseId);
  if (!g.ok) return reFail(g);

  // SPEC §4 regla 1 — disponible al marcar debonding
  const c = await prisma.orthoCase.findUnique({
    where: { id: caseId },
    select: { debondedAt: true, status: true },
  });
  if (!c || (!c.debondedAt && c.status !== "COMPLETED"))
    return fail("conflict", "Disponible al marcar debonding completado");

  // PDF generation: route handler en /api/orthodontics-v2/case/[id]/before-after-pdf
  const url = `/api/orthodontics-v2/case/${caseId}/before-after-pdf`;
  await prisma.retentionPlan.update({
    where: { caseId },
    data: { beforeAfterPdf: url },
  });
  return ok({ url });
}

export async function generateReferralCard(
  caseId: string,
): Promise<Result<{ url: string }>> {
  const auth = await requirePermission("generate_referral_card");
  if (!auth.ok) return reFail(auth);
  const g = await guardCase(auth.data, caseId);
  if (!g.ok) return reFail(g);
  return ok({ url: `/api/orthodontics-v2/case/${caseId}/referral-card-pdf` });
}
