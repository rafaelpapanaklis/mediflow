// Periodontics — server action: clasificar paciente con algoritmo 2017. SPEC §5.3

"use server";

import { revalidatePath } from "next/cache";
import { differenceInYears } from "date-fns";
import { prisma } from "@/lib/prisma";
import { classifyPatientSchema, type Site, type ToothLevel } from "@/lib/periodontics/schemas";
import { classifyPerio2017 } from "@/lib/periodontics/classification-2017";
import { getRadiographicBoneLossPct } from "@/lib/periodontics/periodontogram-math";
import {
  PERIO_AUDIT_ACTIONS,
  auditPerio,
  fail,
  getPerioActionContext,
  isFailure,
  ok,
  type ActionResult,
} from "./_helpers";

/**
 * Ejecuta `classifyPerio2017` sobre un record y persiste la clasificación.
 *
 * Si ya existía una clasificación para ese record, la soft-borra antes de
 * crear la nueva (preserva trail de auditoría — el `id` previo aparecerá
 * en el AuditLog del soft-delete).
 *
 * `boneLossPct` viene del análisis IA de XrayAnalysis si está disponible
 * (stub MVP devuelve undefined → algoritmo cae a GRADE_B por defecto).
 */
export async function classifyPatient(
  input: unknown,
): Promise<ActionResult<{ id: string; stage: string; grade: string | null }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = classifyPatientSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const record = await prisma.periodontalRecord.findFirst({
    where: { id: parsed.data.recordId, clinicId: ctx.clinicId, deletedAt: null },
    select: {
      id: true,
      patientId: true,
      sites: true,
      toothLevel: true,
      patient: { select: { id: true, dob: true } },
    },
  });
  if (!record) return fail("Periodontograma no encontrado");

  const sites = ((record.sites as unknown) as Site[]) ?? [];
  const teeth = ((record.toothLevel as unknown) as ToothLevel[]) ?? [];
  const patientAge = record.patient.dob
    ? differenceInYears(new Date(), record.patient.dob)
    : 0;
  const boneLossPct = await getRadiographicBoneLossPct(record.patientId);

  const out = classifyPerio2017({
    sites,
    toothLevel: teeth,
    patientAge,
    boneLossPct,
    modifiers: parsed.data.modifiers,
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Si ya hay clasificación previa para este record, soft-delete primero.
      const existing = await tx.periodontalClassification.findUnique({
        where: { periodontalRecordId: record.id },
      });
      if (existing && !existing.deletedAt) {
        await tx.periodontalClassification.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        });
      }

      return tx.periodontalClassification.create({
        data: {
          patientId: record.patientId,
          clinicId: ctx.clinicId,
          periodontalRecordId: record.id,
          stage: out.stage,
          grade: out.grade,
          extension: out.extension,
          modifiers: parsed.data.modifiers,
          computationInputs: out.inputs,
          calculatedAutomatically: true,
          classifiedById: ctx.userId,
        },
        select: { id: true, stage: true, grade: true },
      });
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.CLASSIFICATION_COMPUTED,
      entityType: "PeriodontalClassification",
      entityId: created.id,
      after: {
        stage: created.stage,
        grade: created.grade,
        extension: out.extension,
        recordId: record.id,
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${record.patientId}`);
    return ok({ id: created.id, stage: created.stage, grade: created.grade });
  } catch (e) {
    console.error("[perio classification] failed:", e);
    return fail("No se pudo clasificar al paciente");
  }
}
