"use server";
// Pediatrics — server actions para PediatricRecord. Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, fail, isFailure, loadPatientForPediatrics, ok, requirePediatricsPermission, type ActionResult } from "./_helpers";

const pediatricRecordSchema = z.object({
  patientId: z.string().min(1),
  birthWeightKg: z.number().min(0).max(20).optional().nullable(),
  gestationWeeks: z.number().int().min(20).max(45).optional().nullable(),
  prematuro: z.boolean().optional(),
  vaccinationStatus: z.enum(["completo", "incompleto", "desconocido"]).optional(),
  feedingType: z.enum(["materna", "mixta", "formula", "na"]).optional(),
  specialConditions: z.array(z.string()).optional(),
  medication: z.array(z.object({
    name: z.string().min(1),
    dose: z.string().optional(),
    frequency: z.string().optional(),
  })).optional(),
  primaryGuardianId: z.string().optional().nullable(),
  cutoffOverrideYears: z.number().int().min(10).max(18).optional().nullable(),
});

export type CreatePediatricRecordInput = z.infer<typeof pediatricRecordSchema>;

export async function createPediatricRecord(input: CreatePediatricRecordInput): Promise<ActionResult<{ id: string }>> {
  const parsed = pediatricRecordSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const existing = await prisma.pediatricRecord.findUnique({
    where: { patientId: parsed.data.patientId },
    select: { id: true },
  });
  if (existing) return fail("Ya existe un registro pediátrico para este paciente");

  const created = await prisma.pediatricRecord.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      createdBy: ctx.userId,
      birthWeightKg: parsed.data.birthWeightKg ?? null,
      gestationWeeks: parsed.data.gestationWeeks ?? null,
      prematuro: parsed.data.prematuro ?? false,
      vaccinationStatus: parsed.data.vaccinationStatus ?? "desconocido",
      feedingType: parsed.data.feedingType ?? "na",
      specialConditions: parsed.data.specialConditions ?? [],
      medication: parsed.data.medication ?? [],
      primaryGuardianId: parsed.data.primaryGuardianId ?? null,
      cutoffOverrideYears: parsed.data.cutoffOverrideYears ?? null,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.RECORD_CREATED,
    entityType: "pediatric-record",
    entityId: created.id,
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function updatePediatricRecord(
  input: CreatePediatricRecordInput & { id: string },
): Promise<ActionResult<{ id: string }>> {
  const schema = pediatricRecordSchema.extend({ id: z.string().min(1) });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const record = await prisma.pediatricRecord.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!record || record.clinicId !== ctx.clinicId) return fail("Registro no encontrado");

  const updated = await prisma.pediatricRecord.update({
    where: { id: record.id },
    data: {
      birthWeightKg: parsed.data.birthWeightKg ?? null,
      gestationWeeks: parsed.data.gestationWeeks ?? null,
      prematuro: parsed.data.prematuro ?? false,
      vaccinationStatus: parsed.data.vaccinationStatus ?? "desconocido",
      feedingType: parsed.data.feedingType ?? "na",
      specialConditions: parsed.data.specialConditions ?? [],
      medication: parsed.data.medication ?? [],
      primaryGuardianId: parsed.data.primaryGuardianId ?? null,
      cutoffOverrideYears: parsed.data.cutoffOverrideYears ?? null,
      lastReviewedAt: new Date(),
      lastReviewedBy: ctx.userId,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.RECORD_UPDATED,
    entityType: "pediatric-record",
    entityId: updated.id,
  });
  revalidatePath(`/dashboard/patients/${record.patientId}`);
  return ok(updated);
}

export async function getPediatricRecord(patientId: string): Promise<ActionResult<unknown>> {
  if (!patientId) return fail("ID requerido");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const permRes = requirePediatricsPermission(ctx, { write: false });
  if (isFailure(permRes)) return permRes;

  const record = await prisma.pediatricRecord.findUnique({
    where: { patientId },
    include: {
      primaryGuardian: true,
      guardians: { where: { deletedAt: null } },
    },
  });
  if (!record || record.clinicId !== ctx.clinicId) return fail("Sin acceso");
  return ok(record);
}
