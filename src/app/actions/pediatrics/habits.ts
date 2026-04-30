"use server";
// Pediatrics — server actions para OralHabit. Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";

const HABIT_TYPE = [
  "succion_digital", "chupon", "biberon_nocturno",
  "respiracion_bucal", "bruxismo_nocturno", "onicofagia", "deglucion_atipica",
] as const;
const FREQUENCY = ["continua", "nocturna", "ocasional", "na"] as const;

const habitSchema = z.object({
  patientId: z.string().min(1),
  habitType: z.enum(HABIT_TYPE),
  frequency: z.enum(FREQUENCY).optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional().nullable(),
  intervention: z.string().max(300).optional().nullable(),
  interventionStartedAt: z.string().datetime().optional().nullable(),
  interventionType: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type AddHabitInput = z.infer<typeof habitSchema>;

export async function addHabit(input: AddHabitInput): Promise<ActionResult<{ id: string }>> {
  const parsed = habitSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const created = await prisma.oralHabit.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      habitType: parsed.data.habitType,
      frequency: parsed.data.frequency ?? "na",
      startedAt: new Date(parsed.data.startedAt),
      endedAt: parsed.data.endedAt ? new Date(parsed.data.endedAt) : null,
      intervention: parsed.data.intervention ?? null,
      interventionStartedAt: parsed.data.interventionStartedAt ? new Date(parsed.data.interventionStartedAt) : null,
      interventionType: parsed.data.interventionType ?? null,
      notes: parsed.data.notes ?? null,
      createdBy: ctx.userId,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.HABIT_RECORDED,
    entityType: "ped-habit",
    entityId: created.id,
    changes: { habitType: parsed.data.habitType, frequency: parsed.data.frequency ?? "na" },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function updateHabit(
  input: AddHabitInput & { id: string },
): Promise<ActionResult<{ id: string }>> {
  const schema = habitSchema.extend({ id: z.string().min(1) });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const habit = await prisma.oralHabit.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!habit || habit.clinicId !== ctx.clinicId) return fail("Hábito no encontrado");

  await prisma.oralHabit.update({
    where: { id: habit.id },
    data: {
      habitType: parsed.data.habitType,
      frequency: parsed.data.frequency ?? "na",
      startedAt: new Date(parsed.data.startedAt),
      endedAt: parsed.data.endedAt ? new Date(parsed.data.endedAt) : null,
      intervention: parsed.data.intervention ?? null,
      interventionStartedAt: parsed.data.interventionStartedAt ? new Date(parsed.data.interventionStartedAt) : null,
      interventionType: parsed.data.interventionType ?? null,
      notes: parsed.data.notes ?? null,
    },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.HABIT_UPDATED,
    entityType: "ped-habit",
    entityId: habit.id,
  });
  revalidatePath(`/dashboard/patients/${habit.patientId}`);
  return ok({ id: habit.id });
}

export async function resolveHabit(args: { id: string; endedAt?: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const habit = await prisma.oralHabit.findUnique({
    where: { id: args.id },
    select: { id: true, clinicId: true, patientId: true, endedAt: true },
  });
  if (!habit || habit.clinicId !== ctx.clinicId) return fail("Hábito no encontrado");
  if (habit.endedAt) return fail("Este hábito ya fue resuelto");

  await prisma.oralHabit.update({
    where: { id: habit.id },
    data: { endedAt: args.endedAt ? new Date(args.endedAt) : new Date() },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.HABIT_RESOLVED,
    entityType: "ped-habit",
    entityId: habit.id,
  });
  revalidatePath(`/dashboard/patients/${habit.patientId}`);
  return ok({ id: habit.id });
}

export async function deleteHabit(args: { id: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const habit = await prisma.oralHabit.findUnique({
    where: { id: args.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!habit || habit.clinicId !== ctx.clinicId) return fail("Hábito no encontrado");

  await prisma.oralHabit.update({
    where: { id: habit.id },
    data: { deletedAt: new Date() },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.HABIT_DELETED,
    entityType: "ped-habit",
    entityId: habit.id,
  });
  revalidatePath(`/dashboard/patients/${habit.patientId}`);
  return ok({ id: habit.id });
}
