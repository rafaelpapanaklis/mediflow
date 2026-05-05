// Periodontics — server action: reevaluación post-Fase 2. SPEC §5.3

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createReevaluationSchema, type Site, type ToothLevel } from "@/lib/periodontics/schemas";
import { avgPd } from "@/lib/periodontics/periodontogram-math";
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
 * Compara el sondaje inicial vs el post-Fase 2 y persiste métricas de
 * mejora + sitios residuales. Identifica candidatos quirúrgicos: dientes
 * con ≥2 sitios residuales (PD ≥5 + BoP+).
 */
export async function createReevaluation(
  input: unknown,
): Promise<
  ActionResult<{
    id: string;
    bopImprovementPct: number;
    pdAverageImprovementMm: number;
    surgicalCandidatesTeeth: number[];
  }>
> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createReevaluationSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  try {
    const [initial, post, plan] = await Promise.all([
      prisma.periodontalRecord.findFirst({
        where: { id: parsed.data.initialRecordId, clinicId: ctx.clinicId, deletedAt: null },
        select: { id: true, sites: true, toothLevel: true, bopPercentage: true },
      }),
      prisma.periodontalRecord.findFirst({
        where: { id: parsed.data.postRecordId, clinicId: ctx.clinicId, deletedAt: null },
        select: { id: true, sites: true, toothLevel: true, bopPercentage: true },
      }),
      prisma.periodontalTreatmentPlan.findFirst({
        where: { id: parsed.data.planId, clinicId: ctx.clinicId, deletedAt: null },
        select: { id: true, patientId: true },
      }),
    ]);
    if (!initial || !post) return fail("Sondajes no encontrados");
    if (!plan || plan.patientId !== parsed.data.patientId) {
      return fail("Plan no corresponde al paciente");
    }

    const initialSites = ((initial.sites as unknown) as Site[]) ?? [];
    const postSites = ((post.sites as unknown) as Site[]) ?? [];

    const residualSites = postSites.filter((s) => s.pdMm >= 5 && s.bop);

    // Candidatos quirúrgicos = ≥2 sitios residuales por diente.
    const fdiCounts = new Map<number, number>();
    for (const s of residualSites) fdiCounts.set(s.fdi, (fdiCounts.get(s.fdi) ?? 0) + 1);
    const surgicalCandidatesTeeth = Array.from(fdiCounts.entries())
      .filter(([, count]) => count >= 2)
      .map(([fdi]) => fdi)
      .sort((a, b) => a - b);

    const bopImprovementPct = (initial.bopPercentage ?? 0) - (post.bopPercentage ?? 0);
    const pdAverageImprovementMm = avgPd(initialSites) - avgPd(postSites);

    const created = await prisma.periodontalReevaluation.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        planId: parsed.data.planId,
        initialRecordId: initial.id,
        postRecordId: post.id,
        bopImprovementPct,
        pdAverageImprovementMm,
        residualSites,
        surgicalCandidatesTeeth,
        evaluatedById: ctx.userId,
        recommendation: parsed.data.recommendation ?? null,
      },
      select: { id: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.REEVALUATION_CREATED,
      entityType: "PeriodontalReevaluation",
      entityId: created.id,
      after: {
        bopImprovementPct,
        pdAverageImprovementMm,
        residualCount: residualSites.length,
        surgicalCandidatesTeeth,
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({
      id: created.id,
      bopImprovementPct,
      pdAverageImprovementMm,
      surgicalCandidatesTeeth,
    });
  } catch (e) {
    console.error("[perio reevaluation] failed:", e);
    return fail("No se pudo crear la reevaluación");
  }
}
