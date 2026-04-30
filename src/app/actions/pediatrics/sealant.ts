"use server";
// Pediatrics — server actions para Sealant. Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";

const placeSealantSchema = z.object({
  patientId: z.string().min(1),
  toothFdi: z.number().int(),
  material: z.enum(["resina_fotocurada", "ionomero"]),
  placedAt: z.string().datetime(),
  notes: z.string().max(500).optional().nullable(),
});

const updateRetentionSchema = z.object({
  id: z.string().min(1),
  retentionStatus: z.enum(["completo", "parcial", "perdido"]),
  notes: z.string().max(500).optional().nullable(),
});

export async function placeSealant(input: z.infer<typeof placeSealantSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = placeSealantSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const created = await prisma.sealant.upsert({
    where: {
      patientId_toothFdi: { patientId: parsed.data.patientId, toothFdi: parsed.data.toothFdi },
    },
    create: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      toothFdi: parsed.data.toothFdi,
      material: parsed.data.material,
      placedAt: new Date(parsed.data.placedAt),
      placedBy: ctx.userId,
      notes: parsed.data.notes ?? null,
    },
    update: {
      material: parsed.data.material,
      placedAt: new Date(parsed.data.placedAt),
      placedBy: ctx.userId,
      retentionStatus: "completo",
      notes: parsed.data.notes ?? null,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.SEALANT_PLACED,
    entityType: "ped-sealant",
    entityId: created.id,
    changes: { toothFdi: parsed.data.toothFdi, material: parsed.data.material },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function updateSealantRetention(input: z.infer<typeof updateRetentionSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = updateRetentionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const sealant = await prisma.sealant.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!sealant || sealant.clinicId !== ctx.clinicId) return fail("Sellante no encontrado");

  await prisma.sealant.update({
    where: { id: sealant.id },
    data: {
      retentionStatus: parsed.data.retentionStatus,
      lastCheckedAt: new Date(),
      notes: parsed.data.notes ?? undefined,
    },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.SEALANT_UPDATED,
    entityType: "ped-sealant",
    entityId: sealant.id,
    changes: { retentionStatus: parsed.data.retentionStatus },
  });
  revalidatePath(`/dashboard/patients/${sealant.patientId}`);
  return ok({ id: sealant.id });
}

export async function reapplySealant(args: { id: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const sealant = await prisma.sealant.findUnique({
    where: { id: args.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!sealant || sealant.clinicId !== ctx.clinicId) return fail("Sellante no encontrado");

  await prisma.sealant.update({
    where: { id: sealant.id },
    data: {
      reappliedAt: new Date(),
      reappliedBy: ctx.userId,
      retentionStatus: "completo",
      lastCheckedAt: new Date(),
    },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.SEALANT_REAPPLIED,
    entityType: "ped-sealant",
    entityId: sealant.id,
  });
  revalidatePath(`/dashboard/patients/${sealant.patientId}`);
  return ok({ id: sealant.id });
}
