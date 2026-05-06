"use server";
// Pediatrics — server actions para FluorideApplication. Spec: §4.A.9

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { PEDIATRIC_AUDIT_ACTIONS } from "@/lib/pediatrics/audit";
import { auditPediatric, ensurePediatricRecord, fail, isFailure, loadPatientForPediatrics, ok, type ActionResult } from "./_helpers";
import { linkSessionToPlan } from "@/lib/clinical-shared/treatment-link/link";

const fluorideSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().optional().nullable(),
  product: z.enum(["barniz_5pct_naf", "gel_apf", "sdf", "fosfato_acido"]),
  appliedTeeth: z.array(z.number().int()).min(1, "Selecciona al menos un diente"),
  lotNumber: z.string().max(60).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  /** Si está presente, vincula esta aplicación a una sesión del plan. */
  treatmentSessionId: z.string().min(1).optional().nullable(),
});

export type ApplyFluorideInput = z.infer<typeof fluorideSchema>;

export async function applyFluoride(input: ApplyFluorideInput): Promise<ActionResult<{ id: string }>> {
  const parsed = fluorideSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.errors[0]?.message ?? "Datos inválidos");

  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const guard = await loadPatientForPediatrics({ ctx, patientId: parsed.data.patientId });
  if (isFailure(guard)) return guard;

  const record = await ensurePediatricRecord({ ctx, patientId: parsed.data.patientId });

  const created = await prisma.fluorideApplication.create({
    data: {
      clinicId: ctx.clinicId,
      patientId: parsed.data.patientId,
      pediatricRecordId: record.id,
      appointmentId: parsed.data.appointmentId ?? null,
      product: parsed.data.product,
      appliedTeeth: parsed.data.appliedTeeth,
      lotNumber: parsed.data.lotNumber ?? null,
      appliedBy: ctx.userId,
      notes: parsed.data.notes ?? null,
    },
    select: { id: true },
  });

  await auditPediatric({
    ctx,
    action: PEDIATRIC_AUDIT_ACTIONS.FLUORIDE_APPLIED,
    entityType: "ped-fluoride",
    entityId: created.id,
    changes: {
      product: parsed.data.product,
      teethCount: parsed.data.appliedTeeth.length,
    },
  });

  if (parsed.data.treatmentSessionId) {
    try {
      await linkSessionToPlan({
        clinicId: ctx.clinicId,
        module: "pediatrics",
        moduleEntityType: "ped-fluoride",
        moduleSessionId: created.id,
        treatmentSessionId: parsed.data.treatmentSessionId,
        linkedBy: ctx.userId,
      });
    } catch (e) {
      console.warn("[pediatrics.applyFluoride] linkSessionToPlan failed:", (e as Error).message);
    }
  }

  revalidatePath(`/dashboard/patients/${parsed.data.patientId}`);
  return ok(created);
}

export async function getFluorideHistory(patientId: string): Promise<ActionResult<unknown[]>> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");
  const rows = await prisma.fluorideApplication.findMany({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
    orderBy: { appliedAt: "desc" },
    take: 30,
  });
  return ok(rows);
}
