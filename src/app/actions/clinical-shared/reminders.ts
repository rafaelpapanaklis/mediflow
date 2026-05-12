"use server";
// Clinical-shared — server actions para ClinicalReminder.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  ClinicalModule,
  ClinicalReminderType,
  ClinicalReminderStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { auditClinicalShared, guardPatient } from "@/lib/clinical-shared/auth/guard";
import { fail, isFailure, ok, type ActionResult } from "@/lib/clinical-shared/result";
import { nextBirthday } from "@/lib/clinical-shared/reminders/birthday";

const moduleEnum = z.nativeEnum(ClinicalModule);
const typeEnum = z.nativeEnum(ClinicalReminderType);
const statusEnum = z.nativeEnum(ClinicalReminderStatus);

const createSchema = z.object({
  patientId: z.string().min(1),
  module: moduleEnum,
  reminderType: typeEnum,
  dueDate: z.string().datetime(),
  message: z.string().max(1000).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional().nullable(),
});

export async function createClinicalReminder(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  const created = await prisma.clinicalReminder.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: parsed.data.module,
      reminderType: parsed.data.reminderType,
      dueDate: new Date(parsed.data.dueDate),
      message: parsed.data.message ?? null,
      payload: parsed.data.payload ? (parsed.data.payload as object) : undefined,
      createdBy: ctx.userId,
    },
    select: { id: true },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.reminder.created",
    entityType: "clinical-reminder",
    entityId: created.id,
    changes: { module: parsed.data.module, reminderType: parsed.data.reminderType },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

const cancelSchema = z.object({ id: z.string().min(1) });

export async function cancelClinicalReminder(
  input: z.infer<typeof cancelSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const r = await prisma.clinicalReminder.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, clinicId: true, deletedAt: true },
  });
  if (!r || r.deletedAt) return fail("Recordatorio no encontrado");
  if (r.clinicId !== ctx.clinicId) return fail("Sin acceso");

  await prisma.clinicalReminder.update({
    where: { id: r.id },
    data: { status: "cancelled" },
  });
  await auditClinicalShared({
    ctx,
    action: "clinical-shared.reminder.cancelled",
    entityType: "clinical-reminder",
    entityId: r.id,
  });
  return ok({ id: r.id });
}

const listSchema = z.object({
  patientId: z.string().min(1),
  status: statusEnum.optional(),
});

export async function listClinicalReminders(
  input: z.infer<typeof listSchema>,
): Promise<
  ActionResult<
    Array<{
      id: string;
      module: ClinicalModule;
      reminderType: ClinicalReminderType;
      dueDate: string;
      status: ClinicalReminderStatus;
      message: string | null;
      triggeredAt: string | null;
    }>
  >
> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const rows = await prisma.clinicalReminder.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      status: parsed.data.status ?? undefined,
      deletedAt: null,
    },
    orderBy: { dueDate: "asc" },
    take: 100,
  });

  return ok(
    rows.map((r) => ({
      id: r.id,
      module: r.module,
      reminderType: r.reminderType,
      dueDate: r.dueDate.toISOString(),
      status: r.status,
      message: r.message,
      triggeredAt: r.triggeredAt ? r.triggeredAt.toISOString() : null,
    })),
  );
}

// ── Helpers de auto-creación pediátrica ────────────────────────────────

const autoPediatricSchema = z.object({ patientId: z.string().min(1) });

/**
 * Crea (idempotente) los recordatorios pediátricos automáticos para un
 * paciente: profilaxis 6m, control erupción anual, cumpleaños del año.
 * Reusa el mismo dueDate si ya existe un reminder pending del mismo tipo.
 */
export async function autoSeedPediatricReminders(
  input: z.infer<typeof autoPediatricSchema>,
): Promise<ActionResult<{ created: number }>> {
  const parsed = autoPediatricSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);

  const patient = await prisma.patient.findUnique({
    where: { id: parsed.data.patientId },
    select: { dob: true },
  });
  if (!patient) return fail("Paciente no encontrado");

  const now = new Date();
  let created = 0;

  // Profilaxis 6 meses
  await ensurePending({
    clinicId: ctx.clinicId,
    patientId: parsed.data.patientId,
    module: "pediatrics",
    reminderType: "ped_profilaxis_6m",
    dueDate: addMonths(now, 6),
    createdBy: ctx.userId,
    onCreate: () => created++,
  });

  // Control erupción anual (1 año)
  await ensurePending({
    clinicId: ctx.clinicId,
    patientId: parsed.data.patientId,
    module: "pediatrics",
    reminderType: "ped_control_erupcion_anual",
    dueDate: addMonths(now, 12),
    createdBy: ctx.userId,
    onCreate: () => created++,
  });

  // Cumpleaños — 7 días antes del próximo cumpleaños
  if (patient.dob) {
    const next = nextBirthday(patient.dob, now);
    const dueDate = new Date(next.getTime() - 7 * 24 * 3600 * 1000);
    await ensurePending({
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      module: "pediatrics",
      reminderType: "ped_cumpleanos_paciente",
      dueDate,
      createdBy: ctx.userId,
      onCreate: () => created++,
    });
  }

  return ok({ created });
}

// ── Helpers de auto-creación orto ──────────────────────────────────────

const autoOrthoSchema = z.object({
  patientId: z.string().min(1),
  treatmentPlanId: z.string().min(1),
});

/**
 * Crea (idempotente) los recordatorios orto automáticos para un paciente
 * con plan activo:
 *   - cita mensual de control (30 días)
 *   - retiro de aparato próximo (si quedan ≤ 60 días al estimado)
 *   - seguimiento de retención (si plan en RETENTION → 3m, 6m)
 */
export async function autoSeedOrthoReminders(
  input: z.infer<typeof autoOrthoSchema>,
): Promise<ActionResult<{ created: number }>> {
  // Ortodoncia v2 rewrite (feat/ortho-v2-rewrite) — re-cablear en Fase 4 v2
  // con OrthoCase + OrthoTreatmentPlan v2 + ArchPlanned + RetentionPlan.
  // No-op por ahora; el caller recibe Result.ok({ created: 0 }).
  const parsed = autoOrthoSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const guard = await guardPatient({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return fail(guard.error);
  return ok({ created: 0 });
}

async function ensurePending(args: {
  clinicId: string;
  patientId: string;
  module: ClinicalModule;
  reminderType: ClinicalReminderType;
  dueDate: Date;
  createdBy: string;
  payload?: Record<string, unknown>;
  onCreate?: () => void;
}): Promise<void> {
  const existing = await prisma.clinicalReminder.findFirst({
    where: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      reminderType: args.reminderType,
      status: "pending",
      deletedAt: null,
      // Para `other` también compararemos payload.subtype
      ...(args.reminderType === "other" && args.payload?.subtype
        ? {
            payload: {
              path: ["subtype"],
              equals: String(args.payload.subtype),
            },
          }
        : {}),
    },
    select: { id: true },
  });
  if (existing) return;
  await prisma.clinicalReminder.create({
    data: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      module: args.module,
      reminderType: args.reminderType,
      dueDate: args.dueDate,
      payload: args.payload ? (args.payload as object) : undefined,
      createdBy: args.createdBy,
    },
  });
  args.onCreate?.();
}

function addMonths(base: Date, n: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + n);
  return d;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}
