"use server";
// Pediatrics — server actions para Guardian (tutor del menor). Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";

const PARENTESCO = [
  "madre", "padre", "tutor_legal", "abuelo", "abuela",
  "tio", "tia", "hermano", "hermana", "otro",
] as const;

const guardianSchema = z.object({
  patientId: z.string().min(1),
  fullName: z.string().min(2, "Nombre demasiado corto").max(120),
  parentesco: z.enum(PARENTESCO),
  phone: z.string().min(7),
  email: z.string().email().optional().nullable(),
  birthDate: z.string().datetime().optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  ineUrl: z.string().url().optional().nullable(),
  esResponsableLegal: z.boolean().optional(),
  principal: z.boolean().optional(),
});

export type AddGuardianInput = z.infer<typeof guardianSchema>;

export async function addGuardian(input: AddGuardianInput): Promise<ActionResult<{ id: string }>> {
  const parsed = guardianSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.pediatricRecord.findUnique({
      where: { patientId: parsed.data.patientId },
      select: { id: true },
    });
    const recordId = record?.id ?? (await tx.pediatricRecord.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        createdBy: ctx.userId,
      },
      select: { id: true },
    })).id;

    if (parsed.data.principal) {
      await tx.guardian.updateMany({
        where: { patientId: parsed.data.patientId, principal: true, deletedAt: null },
        data: { principal: false },
      });
    }

    return tx.guardian.create({
      data: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        pediatricRecordId: recordId,
        fullName: parsed.data.fullName,
        parentesco: parsed.data.parentesco,
        phone: parsed.data.phone,
        email: parsed.data.email ?? null,
        birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : null,
        address: parsed.data.address ?? null,
        ineUrl: parsed.data.ineUrl ?? null,
        esResponsableLegal: parsed.data.esResponsableLegal ?? true,
        principal: parsed.data.principal ?? false,
        createdBy: ctx.userId,
      },
      select: { id: true },
    });
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.GUARDIAN_ADDED,
    entityType: "ped-guardian",
    entityId: created.id,
    changes: { fullName: parsed.data.fullName, parentesco: parsed.data.parentesco },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function updateGuardian(
  input: AddGuardianInput & { id: string },
): Promise<ActionResult<{ id: string }>> {
  const schema = guardianSchema.extend({ id: z.string().min(1) });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guardian = await prisma.guardian.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!guardian || guardian.clinicId !== ctx.clinicId) return fail("Tutor no encontrado");

  await prisma.$transaction(async (tx) => {
    if (parsed.data.principal) {
      await tx.guardian.updateMany({
        where: {
          patientId: guardian.patientId,
          principal: true,
          deletedAt: null,
          NOT: { id: guardian.id },
        },
        data: { principal: false },
      });
    }
    await tx.guardian.update({
      where: { id: guardian.id },
      data: {
        fullName: parsed.data.fullName,
        parentesco: parsed.data.parentesco,
        phone: parsed.data.phone,
        email: parsed.data.email ?? null,
        birthDate: parsed.data.birthDate ? new Date(parsed.data.birthDate) : null,
        address: parsed.data.address ?? null,
        ineUrl: parsed.data.ineUrl ?? null,
        esResponsableLegal: parsed.data.esResponsableLegal ?? true,
        principal: parsed.data.principal ?? false,
      },
    });
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.GUARDIAN_UPDATED,
    entityType: "ped-guardian",
    entityId: guardian.id,
  });
  revalidatePath(`/dashboard/patients/${guardian.patientId}`);
  return ok({ id: guardian.id });
}

export async function setPrimaryGuardian(args: { guardianId: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guardian = await prisma.guardian.findUnique({
    where: { id: args.guardianId },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!guardian || guardian.clinicId !== ctx.clinicId) return fail("Tutor no encontrado");

  await prisma.$transaction(async (tx) => {
    await tx.guardian.updateMany({
      where: { patientId: guardian.patientId, principal: true },
      data: { principal: false },
    });
    await tx.guardian.update({
      where: { id: guardian.id },
      data: { principal: true },
    });
    const record = await ensurePediatricRecord({ ctx, patientId: guardian.patientId });
    await tx.pediatricRecord.update({
      where: { id: record.id },
      data: { primaryGuardianId: guardian.id },
    });
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.GUARDIAN_UPDATED,
    entityType: "ped-guardian",
    entityId: guardian.id,
    changes: { principal: { before: false, after: true } },
  });
  revalidatePath(`/dashboard/patients/${guardian.patientId}`);
  return ok({ id: guardian.id });
}

export async function deleteGuardian(args: { guardianId: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guardian = await prisma.guardian.findUnique({
    where: { id: args.guardianId },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!guardian || guardian.clinicId !== ctx.clinicId) return fail("Tutor no encontrado");

  await prisma.guardian.update({
    where: { id: guardian.id },
    data: { deletedAt: new Date(), principal: false },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.GUARDIAN_DELETED,
    entityType: "ped-guardian",
    entityId: guardian.id,
  });
  revalidatePath(`/dashboard/patients/${guardian.patientId}`);
  return ok({ id: guardian.id });
}
