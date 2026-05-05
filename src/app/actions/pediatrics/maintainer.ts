"use server";
// Pediatrics — server actions para SpaceMaintainer. Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";

const placeSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().optional().nullable(),
  replacedToothFdi: z.number().int(),
  type: z.enum(["banda_ansa", "corona_ansa", "nance", "arco_lingual", "distal_shoe"]),
  placedAt: z.string().datetime(),
  estimatedRemovalAt: z.string().datetime().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

const updateStatusSchema = z.object({
  id: z.string().min(1),
  currentStatus: z.enum(["activo", "retirado", "fracturado", "perdido"]),
  notes: z.string().max(500).optional().nullable(),
});

const retireSchema = z.object({
  id: z.string().min(1),
  removedAt: z.string().datetime().optional(),
  removedReason: z.string().max(300).optional().nullable(),
});

export async function placeMaintainer(input: z.infer<typeof placeSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = placeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const created = await prisma.spaceMaintainer.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      appointmentId: parsed.data.appointmentId ?? null,
      replacedToothFdi: parsed.data.replacedToothFdi,
      type: parsed.data.type,
      placedAt: new Date(parsed.data.placedAt),
      estimatedRemovalAt: parsed.data.estimatedRemovalAt ? new Date(parsed.data.estimatedRemovalAt) : null,
      placedBy: ctx.userId,
      notes: parsed.data.notes ?? null,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.MAINTAINER_PLACED,
    entityType: "ped-maintainer",
    entityId: created.id,
    changes: { type: parsed.data.type, replacedToothFdi: parsed.data.replacedToothFdi },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function updateMaintainerStatus(input: z.infer<typeof updateStatusSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = updateStatusSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const m = await prisma.spaceMaintainer.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!m || m.clinicId !== ctx.clinicId) return fail("Mantenedor no encontrado");

  await prisma.spaceMaintainer.update({
    where: { id: m.id },
    data: {
      currentStatus: parsed.data.currentStatus,
      notes: parsed.data.notes ?? undefined,
    },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.MAINTAINER_UPDATED,
    entityType: "ped-maintainer",
    entityId: m.id,
    changes: { currentStatus: parsed.data.currentStatus },
  });
  revalidatePath(`/dashboard/patients/${m.patientId}`);
  return ok({ id: m.id });
}

export async function retireMaintainer(input: z.infer<typeof retireSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = retireSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const m = await prisma.spaceMaintainer.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!m || m.clinicId !== ctx.clinicId) return fail("Mantenedor no encontrado");

  await prisma.spaceMaintainer.update({
    where: { id: m.id },
    data: {
      currentStatus: "retirado",
      removedAt: parsed.data.removedAt ? new Date(parsed.data.removedAt) : new Date(),
      removedBy: ctx.userId,
      removedReason: parsed.data.removedReason ?? null,
    },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.MAINTAINER_RETIRED,
    entityType: "ped-maintainer",
    entityId: m.id,
  });
  revalidatePath(`/dashboard/patients/${m.patientId}`);
  return ok({ id: m.id });
}
