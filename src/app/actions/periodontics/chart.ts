// Periodontics — server actions del periodontograma (record completo). SPEC §5.3

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  createPeriodontalRecordSchema,
  updatePeriodontalRecordSchema,
  finalizePerioChartSchema,
  type Site,
  type ToothLevel,
} from "@/lib/periodontics/schemas";
import { computePerioMetrics } from "@/lib/periodontics/periodontogram-math";
import {
  PERIO_AUDIT_ACTIONS,
  auditPerio,
  fail,
  getPerioActionContext,
  isFailure,
  loadPatientForPerio,
  ok,
  type ActionResult,
} from "./_helpers";

/**
 * Crea un periodontograma completo desde cero. Calcula métricas in-memory
 * antes del INSERT para guardar `bopPercentage`, `plaqueIndexOleary`, etc.
 * sin un round-trip extra. Audita el create.
 */
export async function createPeriodontalRecord(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createPeriodontalRecordSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  const metrics = computePerioMetrics(parsed.data.sites, parsed.data.toothLevel);

  try {
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.periodontalRecord.create({
        data: {
          patientId: parsed.data.patientId,
          clinicId: ctx.clinicId,
          doctorId: ctx.userId,
          recordType: parsed.data.recordType,
          sites: parsed.data.sites,
          toothLevel: parsed.data.toothLevel,
          bopPercentage: metrics.bopPct,
          plaqueIndexOleary: metrics.plaquePct,
          sites1to3mm: metrics.sites1to3,
          sites4to5mm: metrics.sites4to5,
          sites6PlusMm: metrics.sites6plus,
          teethWithPockets5Plus: metrics.teethWithPockets5plus,
          notes: parsed.data.notes ?? null,
          durationMinutes: parsed.data.durationMinutes ?? null,
          comparedToRecordId: parsed.data.comparedToRecordId ?? null,
        },
      });
      return created;
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.RECORD_CREATED,
      entityType: "PeriodontalRecord",
      entityId: record.id,
      after: { id: record.id, recordType: record.recordType, ...metrics },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/periodontics`);

    return ok({ id: record.id });
  } catch (e) {
    console.error("[perio chart] create failed:", e);
    return fail("No se pudo crear el periodontograma");
  }
}

/**
 * Actualiza notas/duración del record. NO toca sites — se usa upsertSiteData.
 */
export async function updatePeriodontalRecord(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = updatePeriodontalRecordSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const before = await prisma.periodontalRecord.findFirst({
    where: { id: parsed.data.recordId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, notes: true, durationMinutes: true, patientId: true },
  });
  if (!before) return fail("Periodontograma no encontrado");

  try {
    const next = await prisma.periodontalRecord.update({
      where: { id: before.id },
      data: {
        notes: parsed.data.notes ?? null,
        durationMinutes: parsed.data.durationMinutes ?? null,
      },
      select: { id: true, notes: true, durationMinutes: true, patientId: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.RECORD_UPDATED,
      entityType: "PeriodontalRecord",
      entityId: next.id,
      before: { notes: before.notes, durationMinutes: before.durationMinutes },
      after: { notes: next.notes, durationMinutes: next.durationMinutes },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${next.patientId}`);
    return ok({ id: next.id });
  } catch (e) {
    console.error("[perio chart] update failed:", e);
    return fail("No se pudo actualizar el periodontograma");
  }
}

/**
 * Marca el sondaje como finalizado: recalcula métricas con el estado actual
 * de sites/toothLevel y dispara revalidate. Útil al cerrar la captura.
 */
export async function finalizePerioChart(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = finalizePerioChartSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const record = await prisma.periodontalRecord.findFirst({
    where: { id: parsed.data.recordId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, sites: true, toothLevel: true, patientId: true },
  });
  if (!record) return fail("Periodontograma no encontrado");

  const sites = (record.sites as unknown as Site[]) ?? [];
  const teeth = (record.toothLevel as unknown as ToothLevel[]) ?? [];
  const metrics = computePerioMetrics(sites, teeth);

  try {
    await prisma.periodontalRecord.update({
      where: { id: record.id },
      data: {
        bopPercentage: metrics.bopPct,
        plaqueIndexOleary: metrics.plaquePct,
        sites1to3mm: metrics.sites1to3,
        sites4to5mm: metrics.sites4to5,
        sites6PlusMm: metrics.sites6plus,
        teethWithPockets5Plus: metrics.teethWithPockets5plus,
      },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.RECORD_FINALIZED,
      entityType: "PeriodontalRecord",
      entityId: record.id,
      meta: metrics,
    });

    revalidatePath(`/dashboard/specialties/periodontics/${record.patientId}`);
    return ok({ id: record.id });
  } catch (e) {
    console.error("[perio chart] finalize failed:", e);
    return fail("No se pudo finalizar el periodontograma");
  }
}

/** Soft-delete del record (deletedAt). Útil para corregir un sondaje erróneo. */
export async function deletePeriodontalRecord(
  recordId: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  if (typeof recordId !== "string" || !recordId) return fail("recordId requerido");

  const before = await prisma.periodontalRecord.findFirst({
    where: { id: recordId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true },
  });
  if (!before) return fail("Periodontograma no encontrado");

  try {
    await prisma.periodontalRecord.update({
      where: { id: before.id },
      data: { deletedAt: new Date() },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.RECORD_DELETED,
      entityType: "PeriodontalRecord",
      entityId: before.id,
      before: { id: before.id },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${before.patientId}`);
    return ok({ id: before.id });
  } catch (e) {
    console.error("[perio chart] delete failed:", e);
    return fail("No se pudo borrar el periodontograma");
  }
}
