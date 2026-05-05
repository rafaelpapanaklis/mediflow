"use server";
// Orthodontics — action 3/15: createTreatmentPlan + 6 phases en transacción. SPEC §5.2.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createTreatmentPlanSchema } from "@/lib/validation/orthodontics";
import { PHASE_ORDER } from "@/lib/orthodontics/phase-machine";
import {
  auditOrtho,
  getOrthoActionContext,
  loadPatientForOrtho,
} from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createTreatmentPlan(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createTreatmentPlanSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForOrtho({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  // Validar que el diagnóstico exista y no esté tomado por otro plan.
  const dx = await prisma.orthodonticDiagnosis.findFirst({
    where: { id: parsed.data.diagnosisId, clinicId: ctx.clinicId, deletedAt: null },
    include: { treatmentPlan: { select: { id: true } } },
  });
  if (!dx) return fail("Diagnóstico no encontrado");
  if (dx.treatmentPlan)
    return fail("Ya existe un plan para este diagnóstico", dx.treatmentPlan.id);

  const installedAt = parsed.data.installedAt ? new Date(parsed.data.installedAt) : null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const plan = await tx.orthodonticTreatmentPlan.create({
        data: {
          diagnosisId: parsed.data.diagnosisId,
          patientId: parsed.data.patientId,
          clinicId: ctx.clinicId,
          technique: parsed.data.technique,
          techniqueNotes: parsed.data.techniqueNotes ?? null,
          estimatedDurationMonths: parsed.data.estimatedDurationMonths,
          startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
          installedAt,
          totalCostMxn: parsed.data.totalCostMxn,
          anchorageType: parsed.data.anchorageType,
          anchorageNotes: parsed.data.anchorageNotes ?? null,
          extractionsRequired: parsed.data.extractionsRequired,
          extractionsTeethFdi: parsed.data.extractionsTeethFdi,
          iprRequired: parsed.data.iprRequired,
          tadsRequired: parsed.data.tadsRequired,
          treatmentObjectives: parsed.data.treatmentObjectives,
          patientGoals: parsed.data.patientGoals ?? null,
          retentionPlanText: parsed.data.retentionPlanText,
          status: installedAt ? "IN_PROGRESS" : "PLANNED",
          signedTreatmentConsentFileId: parsed.data.signedTreatmentConsentFileId ?? null,
        },
      });

      // 6 fases con orderIndex 0..5. Si hay installedAt, ALIGNMENT arranca.
      for (let i = 0; i < PHASE_ORDER.length; i++) {
        const phaseKey = PHASE_ORDER[i]!;
        const isFirst = i === 0;
        await tx.orthodonticPhase.create({
          data: {
            treatmentPlanId: plan.id,
            clinicId: ctx.clinicId,
            phaseKey,
            orderIndex: i,
            status: isFirst && installedAt ? "IN_PROGRESS" : "NOT_STARTED",
            startedAt: isFirst && installedAt ? installedAt : null,
          },
        });
      }

      return plan;
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.TREATMENT_PLAN_CREATED,
      entityType: "OrthodonticTreatmentPlan",
      entityId: created.id,
      after: {
        technique: created.technique,
        durationMonths: created.estimatedDurationMonths,
        totalCostMxn: created.totalCostMxn.toString(),
        installed: Boolean(installedAt),
      },
    });

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: created.id });
  } catch (e) {
    console.error("[ortho] createTreatmentPlan failed:", e);
    return fail("No se pudo crear el plan");
  }
}
