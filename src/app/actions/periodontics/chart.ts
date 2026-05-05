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
import { FDI_ALL, SITE_CAPTURE_ORDER } from "@/lib/periodontics/site-helpers";
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

/**
 * Crea un periodontograma vacío con sites placeholder (PD=3, REC=-1, todos
 * los marcadores en false → estado "sano por defecto") para que el usuario
 * pueda empezar a editar de inmediato desde la UI del periodontograma sin
 * tener que rellenar los 192 sitios desde un wizard.
 *
 * Convención: si es el primer record del paciente → recordType=INICIAL;
 * si ya hay records previos → MANTENIMIENTO. El usuario puede cambiar el
 * tipo después con updatePeriodontalRecord (no expuesto aún en UI; vive
 * en server actions).
 *
 * Multi-tenant + audit log + revalidatePath. Devuelve `existingId` si ya
 * hay un sondaje del día para este paciente — evita duplicados accidentales
 * por doble click.
 */
export async function createEmptyPeriodontalRecord(
  patientId: string,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  if (typeof patientId !== "string" || !patientId) return fail("patientId requerido");

  const patient = await loadPatientForPerio({ ctx, patientId });
  if (isFailure(patient)) return patient;

  // Anti-doble-click: si hay un record creado en los últimos 60s, lo devuelve.
  const since = new Date(Date.now() - 60_000);
  const recent = await prisma.periodontalRecord.findFirst({
    where: {
      patientId,
      clinicId: ctx.clinicId,
      deletedAt: null,
      createdAt: { gt: since },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (recent) {
    return fail("Ya se creó un sondaje hace menos de 1 minuto", recent.id);
  }

  // Detecta si es primer sondaje o subsecuente.
  const previousCount = await prisma.periodontalRecord.count({
    where: { patientId, clinicId: ctx.clinicId, deletedAt: null },
  });
  const recordType = previousCount === 0 ? "INICIAL" : "MANTENIMIENTO";

  // Sites placeholder: 192 sitios sanos (6 posiciones × 32 dientes).
  const sites: Site[] = [];
  for (const fdi of FDI_ALL) {
    for (const position of SITE_CAPTURE_ORDER) {
      sites.push({
        fdi,
        position,
        pdMm: 3,
        recMm: -1,
        bop: false,
        plaque: false,
        suppuration: false,
      });
    }
  }
  const teeth: ToothLevel[] = FDI_ALL.map((fdi) => ({
    fdi,
    mobility: 0,
    furcation: 0,
    absent: false,
    isImplant: false,
  }));

  const metrics = computePerioMetrics(sites, teeth);

  try {
    const created = await prisma.periodontalRecord.create({
      data: {
        patientId,
        clinicId: ctx.clinicId,
        doctorId: ctx.userId,
        recordType,
        sites,
        toothLevel: teeth,
        bopPercentage: metrics.bopPct,
        plaqueIndexOleary: metrics.plaquePct,
        sites1to3mm: metrics.sites1to3,
        sites4to5mm: metrics.sites4to5,
        sites6PlusMm: metrics.sites6plus,
        teethWithPockets5Plus: metrics.teethWithPockets5plus,
      },
      select: { id: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.RECORD_CREATED,
      entityType: "PeriodontalRecord",
      entityId: created.id,
      after: { recordType, placeholder: true, sitesCount: sites.length },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${patientId}`);
    revalidatePath(`/dashboard/specialties/periodontics`);
    revalidatePath(`/dashboard/patients/${patientId}`);

    return ok({ id: created.id });
  } catch (e) {
    console.error("[perio chart] createEmpty failed:", e);
    return fail("No se pudo crear el sondaje");
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
