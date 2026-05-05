// Periodontics — server actions del plan de tratamiento (4 fases). SPEC §5.2

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  createTreatmentPlanSchema,
  advancePhaseSchema,
} from "@/lib/periodontics/schemas";
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
 * Crea un plan de tratamiento periodontal en Fase 1 (control sistémico +
 * higiene). Si ya existe un plan activo (deletedAt=null) para el paciente,
 * devuelve `existingId` en lugar de crear uno nuevo — un paciente sólo
 * cursa un plan a la vez.
 */
export async function createTreatmentPlan(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createTreatmentPlanSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  const existing = await prisma.periodontalTreatmentPlan.findFirst({
    where: { patientId: parsed.data.patientId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return fail("Ya existe un plan activo para este paciente", existing.id);

  try {
    const created = await prisma.periodontalTreatmentPlan.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        currentPhase: parsed.data.currentPhase,
        phase1StartedAt: parsed.data.currentPhase === "PHASE_1" ? new Date() : null,
        planNotes: parsed.data.planNotes ?? null,
      },
      select: { id: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.PLAN_CREATED,
      entityType: "PeriodontalTreatmentPlan",
      entityId: created.id,
      after: { phase: parsed.data.currentPhase, patientId: parsed.data.patientId },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ id: created.id });
  } catch (e) {
    console.error("[perio plan] create failed:", e);
    return fail("No se pudo crear el plan");
  }
}

/**
 * Avanza el plan a la siguiente fase. Marca `phaseN_CompletedAt` de la
 * fase actual y `phaseM_StartedAt` de la nueva. NO valida que sea estrictamente
 * la siguiente — el doctor puede saltar fases (ej. de Fase 1 a Fase 4 si
 * el paciente sólo necesita mantenimiento).
 */
export async function advancePhase(
  input: unknown,
): Promise<ActionResult<{ id: string; phase: "PHASE_1" | "PHASE_2" | "PHASE_3" | "PHASE_4" }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = advancePhaseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const before = await prisma.periodontalTreatmentPlan.findFirst({
    where: { id: parsed.data.planId, clinicId: ctx.clinicId, deletedAt: null },
  });
  if (!before) return fail("Plan no encontrado");

  const now = new Date();
  const data: Record<string, Date | string | null> = {
    currentPhase: parsed.data.toPhase,
  };

  // Cierra la fase actual.
  if (before.currentPhase === "PHASE_1" && !before.phase1CompletedAt) data.phase1CompletedAt = now;
  if (before.currentPhase === "PHASE_2" && !before.phase2CompletedAt) data.phase2CompletedAt = now;
  if (before.currentPhase === "PHASE_3" && !before.phase3CompletedAt) data.phase3CompletedAt = now;
  // PHASE_4 (mantenimiento) no se "completa", se sostiene en el tiempo.

  // Abre la nueva fase si aún no estaba iniciada.
  if (parsed.data.toPhase === "PHASE_1" && !before.phase1StartedAt) data.phase1StartedAt = now;
  if (parsed.data.toPhase === "PHASE_2" && !before.phase2StartedAt) data.phase2StartedAt = now;
  if (parsed.data.toPhase === "PHASE_3" && !before.phase3StartedAt) data.phase3StartedAt = now;
  if (parsed.data.toPhase === "PHASE_4" && !before.phase4StartedAt) data.phase4StartedAt = now;

  try {
    const next = await prisma.periodontalTreatmentPlan.update({
      where: { id: before.id },
      data,
      select: {
        id: true,
        patientId: true,
        currentPhase: true,
        phase1CompletedAt: true,
        phase2CompletedAt: true,
        phase3CompletedAt: true,
      },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.PHASE_ADVANCED,
      entityType: "PeriodontalTreatmentPlan",
      entityId: next.id,
      before: { currentPhase: before.currentPhase },
      after: { currentPhase: next.currentPhase },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${next.patientId}`);
    return ok({ id: next.id, phase: next.currentPhase });
  } catch (e) {
    console.error("[perio plan] advancePhase failed:", e);
    return fail("No se pudo avanzar la fase");
  }
}
