"use server";
// Pediatrics — server actions para BehaviorAssessment (Frankl/Venham). Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";

const behaviorSchema = z.object({
  patientId: z.string().min(1),
  scale: z.enum(["frankl", "venham"]),
  value: z.number().int().min(0).max(5),
  appointmentId: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type CaptureBehaviorInput = z.infer<typeof behaviorSchema>;

export async function captureBehavior(input: CaptureBehaviorInput): Promise<ActionResult<{ id: string }>> {
  const parsed = behaviorSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  if (parsed.data.scale === "frankl" && (parsed.data.value < 1 || parsed.data.value > 4)) {
    return fail("Frankl debe estar en 1-4");
  }
  if (parsed.data.scale === "venham" && (parsed.data.value < 0 || parsed.data.value > 5)) {
    return fail("Venham debe estar en 0-5");
  }

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const created = await prisma.behaviorAssessment.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      appointmentId: parsed.data.appointmentId ?? null,
      scale: parsed.data.scale,
      value: parsed.data.value,
      notes: parsed.data.notes ?? null,
      recordedBy: ctx.userId,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.FRANKL_CAPTURED,
    entityType: "ped-behavior",
    entityId: created.id,
    changes: { scale: parsed.data.scale, value: parsed.data.value },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function getBehaviorHistory(patientId: string): Promise<ActionResult<Array<{ id: string; scale: string; value: number; recordedAt: Date; notes: string | null }>>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const rows = await prisma.behaviorAssessment.findMany({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { recordedAt: "desc" },
    take: 50,
    select: { id: true, scale: true, value: true, recordedAt: true, notes: true },
  });
  return ok(rows);
}

export async function deleteBehavior(args: { id: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const row = await prisma.behaviorAssessment.findUnique({
    where: { id: args.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!row || row.clinicId !== ctx.clinicId) return fail("Registro no encontrado");

  await prisma.behaviorAssessment.update({
    where: { id: row.id },
    data: { deletedAt: new Date() },
  });

  await auditPediatric({
    ctx,
    action: "pediatrics.behavior.deleted",
    entityType: "ped-behavior",
    entityId: row.id,
  });
  revalidatePath(`/dashboard/patients/${row.patientId}`);
  return ok({ id: row.id });
}
