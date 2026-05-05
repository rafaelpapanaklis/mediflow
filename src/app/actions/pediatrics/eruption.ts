"use server";
// Pediatrics — server actions para EruptionRecord. Spec: §4.A.9, §1.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { calculateAge } from "@/lib/pediatrics/age";
import { evaluateDeviation, getRangeForFdi } from "@/lib/pediatrics/eruption-data";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";

const eruptionSchema = z.object({
  patientId: z.string().min(1),
  toothFdi: z.number().int(),
  observedAt: z.string().datetime(),
  notes: z.string().max(500).optional().nullable(),
});

export type RecordEruptionInput = z.infer<typeof eruptionSchema>;

export async function recordEruption(input: RecordEruptionInput): Promise<ActionResult<{ id: string; deviation: string }>> {
  const parsed = eruptionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const range = getRangeForFdi(parsed.data.toothFdi);
  if (!range) return fail("Diente FDI inválido");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;
  if (!guard.data.dob) return fail("El paciente no tiene fecha de nacimiento registrada");

  const observed = new Date(parsed.data.observedAt);
  const ageAtEruption = calculateAge(guard.data.dob, observed);
  const deviation = evaluateDeviation(ageAtEruption.totalMonths, range);
  const within = deviation === "within";

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const created = await prisma.eruptionRecord.upsert({
    where: {
      patientId_toothFdi: {
        patientId: parsed.data.patientId,
        toothFdi: parsed.data.toothFdi,
      },
    },
    create: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      toothFdi: parsed.data.toothFdi,
      observedAt: observed,
      ageAtEruptionDecimal: ageAtEruption.decimal,
      withinExpectedRange: within,
      deviation,
      notes: parsed.data.notes ?? null,
      recordedBy: ctx.userId,
    },
    update: {
      observedAt: observed,
      ageAtEruptionDecimal: ageAtEruption.decimal,
      withinExpectedRange: within,
      deviation,
      notes: parsed.data.notes ?? null,
      recordedBy: ctx.userId,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.ERUPTION_RECORDED,
    entityType: "ped-eruption",
    entityId: created.id,
    changes: { toothFdi: parsed.data.toothFdi, deviation },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok({ id: created.id, deviation });
}

export async function deleteEruption(args: { id: string }): Promise<ActionResult<{ id: string }>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const row = await prisma.eruptionRecord.findUnique({
    where: { id: args.id },
    select: { id: true, clinicId: true, patientId: true },
  });
  if (!row || row.clinicId !== ctx.clinicId) return fail("Registro no encontrado");

  await prisma.eruptionRecord.update({
    where: { id: row.id },
    data: { deletedAt: new Date() },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.ERUPTION_DELETED,
    entityType: "ped-eruption",
    entityId: row.id,
  });
  revalidatePath(`/dashboard/patients/${row.patientId}`);
  return ok({ id: row.id });
}
