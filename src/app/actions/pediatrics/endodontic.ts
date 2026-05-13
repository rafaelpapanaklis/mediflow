"use server";
// Pediatrics — server actions para PediatricEndodonticTreatment. Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, requirePediatricsPermission, type ActionResult } from "./_helpers";

const endoSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().optional().nullable(),
  toothFdi: z.number().int(),
  treatmentType: z.enum([
    "pulpotomia", "pulpectomia",
    "recubrimiento_indirecto", "recubrimiento_directo",
  ]),
  material: z.enum(["formocresol", "mta", "sulfato_ferrico", "hidroxido_calcio", "otro"]),
  performedAt: z.string().datetime(),
  residualVitality: z.string().max(120).optional().nullable(),
  postOpSymptoms: z.string().max(300).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  xrayUrl: z.string().url().optional().nullable(),
});

export type RecordEndoTreatmentInput = z.infer<typeof endoSchema>;

export async function recordEndoTreatment(input: RecordEndoTreatmentInput): Promise<ActionResult<{ id: string }>> {
  const parsed = endoSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const created = await prisma.pediatricEndodonticTreatment.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      appointmentId: parsed.data.appointmentId ?? null,
      toothFdi: parsed.data.toothFdi,
      treatmentType: parsed.data.treatmentType,
      material: parsed.data.material,
      performedAt: new Date(parsed.data.performedAt),
      performedBy: ctx.userId,
      residualVitality: parsed.data.residualVitality ?? null,
      postOpSymptoms: parsed.data.postOpSymptoms ?? null,
      notes: parsed.data.notes ?? null,
      xrayUrl: parsed.data.xrayUrl ?? null,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.ENDO_RECORDED,
    entityType: "ped-endodontic",
    entityId: created.id,
    changes: { toothFdi: parsed.data.toothFdi, treatmentType: parsed.data.treatmentType },
  });
  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function getEndoHistory(patientId: string): Promise<ActionResult<unknown[]>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const permRes = requirePediatricsPermission(ctx, { write: false });
  if (isFailure(permRes)) return permRes;
  const rows = await prisma.pediatricEndodonticTreatment.findMany({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { performedAt: "desc" },
    take: 30,
  });
  return ok(rows);
}
