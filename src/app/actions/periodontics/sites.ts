// Periodontics — actions granulares para sites/toothLevel (autosave por celda). SPEC §5.3

"use server";

import { prisma } from "@/lib/prisma";
import {
  upsertSiteDataSchema,
  upsertToothDataSchema,
  bulkUpsertSiteDataSchema,
  type Site,
  type ToothLevel,
} from "@/lib/periodontics/schemas";
import { computePerioMetrics, type PerioMetrics } from "@/lib/periodontics/periodontogram-math";
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
 * Autosave granular de UN sitio. Reemplaza la entrada en `sites` por
 * `(fdi, position)` o la inserta si no existía. Recalcula métricas y las
 * persiste para que el header (LiveIndicators) siempre lea de DB.
 *
 * NO usa revalidatePath: la celda hace optimistic update local y el cliente
 * ya tiene la métrica calculada vía `metrics` que devolvemos.
 *
 * Convención: el cliente debe debounce 300ms para no saturar (SPEC §1, §13.3).
 */
export async function upsertSiteData(
  input: unknown,
): Promise<ActionResult<{ recordId: string; updatedAt: Date; metrics: PerioMetrics }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = upsertSiteDataSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.periodontalRecord.findFirst({
        where: { id: parsed.data.recordId, clinicId: ctx.clinicId, deletedAt: null },
        select: { id: true, sites: true, toothLevel: true },
      });
      if (!record) throw new Error("RECORD_NOT_FOUND");

      const sites = ((record.sites as unknown) as Site[]) ?? [];
      const teeth = ((record.toothLevel as unknown) as ToothLevel[]) ?? [];

      const idx = sites.findIndex(
        (s) => s.fdi === parsed.data.site.fdi && s.position === parsed.data.site.position,
      );
      if (idx >= 0) sites[idx] = parsed.data.site;
      else sites.push(parsed.data.site);

      const metrics = computePerioMetrics(sites, teeth);

      const next = await tx.periodontalRecord.update({
        where: { id: record.id },
        data: {
          sites,
          bopPercentage: metrics.bopPct,
          plaqueIndexOleary: metrics.plaquePct,
          sites1to3mm: metrics.sites1to3,
          sites4to5mm: metrics.sites4to5,
          sites6PlusMm: metrics.sites6plus,
          teethWithPockets5Plus: metrics.teethWithPockets5plus,
        },
        select: { id: true, updatedAt: true },
      });

      return { record: next, metrics };
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.SITE_UPSERT,
      entityType: "PeriodontalRecord",
      entityId: result.record.id,
      meta: {
        fdi: parsed.data.site.fdi,
        position: parsed.data.site.position,
        pdMm: parsed.data.site.pdMm,
        recMm: parsed.data.site.recMm,
        bop: parsed.data.site.bop,
      },
    });

    return ok({
      recordId: result.record.id,
      updatedAt: result.record.updatedAt,
      metrics: result.metrics,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "RECORD_NOT_FOUND") {
      return fail("Periodontograma no encontrado");
    }
    console.error("[perio sites] upsertSiteData failed:", e);
    return fail("No se pudo guardar el sitio");
  }
}

/**
 * Upsert por diente: movilidad, furcación, ausente, isImplant. Misma
 * mecánica que upsertSiteData pero sobre `toothLevel`.
 */
export async function upsertToothData(
  input: unknown,
): Promise<ActionResult<{ recordId: string; updatedAt: Date; metrics: PerioMetrics }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = upsertToothDataSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.periodontalRecord.findFirst({
        where: { id: parsed.data.recordId, clinicId: ctx.clinicId, deletedAt: null },
        select: { id: true, sites: true, toothLevel: true },
      });
      if (!record) throw new Error("RECORD_NOT_FOUND");

      const sites = ((record.sites as unknown) as Site[]) ?? [];
      const teeth = ((record.toothLevel as unknown) as ToothLevel[]) ?? [];

      const idx = teeth.findIndex((t) => t.fdi === parsed.data.tooth.fdi);
      if (idx >= 0) teeth[idx] = parsed.data.tooth;
      else teeth.push(parsed.data.tooth);

      // Si el diente quedó marcado ausente, los métricos cambian (excluido del denominador).
      const metrics = computePerioMetrics(sites, teeth);

      const next = await tx.periodontalRecord.update({
        where: { id: record.id },
        data: {
          toothLevel: teeth,
          bopPercentage: metrics.bopPct,
          plaqueIndexOleary: metrics.plaquePct,
          sites1to3mm: metrics.sites1to3,
          sites4to5mm: metrics.sites4to5,
          sites6PlusMm: metrics.sites6plus,
          teethWithPockets5Plus: metrics.teethWithPockets5plus,
        },
        select: { id: true, updatedAt: true },
      });

      return { record: next, metrics };
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.TOOTH_UPSERT,
      entityType: "PeriodontalRecord",
      entityId: result.record.id,
      meta: {
        fdi: parsed.data.tooth.fdi,
        mobility: parsed.data.tooth.mobility,
        furcation: parsed.data.tooth.furcation,
        absent: parsed.data.tooth.absent,
        isImplant: parsed.data.tooth.isImplant,
      },
    });

    return ok({
      recordId: result.record.id,
      updatedAt: result.record.updatedAt,
      metrics: result.metrics,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "RECORD_NOT_FOUND") {
      return fail("Periodontograma no encontrado");
    }
    console.error("[perio sites] upsertToothData failed:", e);
    return fail("No se pudo guardar el diente");
  }
}

/**
 * Bulk upsert de varios sitios en una sola transacción. Útil cuando el
 * cliente acumula cambios offline o cuando la captura por voz sube un
 * cuadrante completo de golpe.
 */
export async function bulkUpsertSiteData(
  input: unknown,
): Promise<ActionResult<{ recordId: string; updatedAt: Date; metrics: PerioMetrics }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = bulkUpsertSiteDataSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.periodontalRecord.findFirst({
        where: { id: parsed.data.recordId, clinicId: ctx.clinicId, deletedAt: null },
        select: { id: true, sites: true, toothLevel: true },
      });
      if (!record) throw new Error("RECORD_NOT_FOUND");

      const sites = ((record.sites as unknown) as Site[]) ?? [];
      const teeth = ((record.toothLevel as unknown) as ToothLevel[]) ?? [];

      for (const site of parsed.data.sites) {
        const idx = sites.findIndex((s) => s.fdi === site.fdi && s.position === site.position);
        if (idx >= 0) sites[idx] = site;
        else sites.push(site);
      }

      const metrics = computePerioMetrics(sites, teeth);

      const next = await tx.periodontalRecord.update({
        where: { id: record.id },
        data: {
          sites,
          bopPercentage: metrics.bopPct,
          plaqueIndexOleary: metrics.plaquePct,
          sites1to3mm: metrics.sites1to3,
          sites4to5mm: metrics.sites4to5,
          sites6PlusMm: metrics.sites6plus,
          teethWithPockets5Plus: metrics.teethWithPockets5plus,
        },
        select: { id: true, updatedAt: true },
      });

      return { record: next, metrics };
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.SITES_BULK_UPSERT,
      entityType: "PeriodontalRecord",
      entityId: result.record.id,
      meta: { sitesCount: parsed.data.sites.length },
    });

    return ok({
      recordId: result.record.id,
      updatedAt: result.record.updatedAt,
      metrics: result.metrics,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "RECORD_NOT_FOUND") {
      return fail("Periodontograma no encontrado");
    }
    console.error("[perio sites] bulkUpsert failed:", e);
    return fail("No se pudo guardar el lote de sitios");
  }
}
