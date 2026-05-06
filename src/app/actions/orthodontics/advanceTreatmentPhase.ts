"use server";
// Orthodontics — action 5/15: advanceTreatmentPhase con phase-machine. SPEC §5.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { advanceTreatmentPhaseSchema } from "@/lib/validation/orthodontics";
import { canAdvance, requiresInitialPhotosBefore } from "@/lib/orthodontics/phase-machine";
import { isCompleteSet } from "@/lib/orthodontics/photo-set-helpers";
import { linkSessionToPlan } from "@/lib/clinical-shared/treatment-link/link";
import { auditOrtho, getOrthoActionContext } from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function advanceTreatmentPhase(
  input: unknown,
): Promise<ActionResult<{ planId: string; toPhase: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = advanceTreatmentPhaseSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const plan = await prisma.orthodonticTreatmentPlan.findFirst({
    where: { id: parsed.data.treatmentPlanId, clinicId: ctx.clinicId, deletedAt: null },
    include: { phases: { orderBy: { orderIndex: "asc" } } },
  });
  if (!plan) return fail("Plan no encontrado");

  const currentPhase = plan.phases.find((p) => p.status === "IN_PROGRESS");
  if (!currentPhase) {
    return fail("Plan sin fase activa — instala la aparatología primero");
  }

  if (!canAdvance(currentPhase.phaseKey, parsed.data.toPhase)) {
    return fail(
      `Transición inválida: ${currentPhase.phaseKey} → ${parsed.data.toPhase}. Solo avance lineal +1.`,
    );
  }

  // Guard: ALIGNMENT → LEVELING requiere set fotográfico T0 completo.
  if (currentPhase.phaseKey === "ALIGNMENT" && parsed.data.toPhase === "LEVELING") {
    const t0 = await prisma.orthoPhotoSet.findFirst({
      where: { treatmentPlanId: plan.id, setType: "T0" },
      select: {
        photoFrontalId: true,
        photoProfileId: true,
        photoSmileId: true,
        photoIntraFrontalId: true,
        photoIntraLateralRId: true,
        photoIntraLateralLId: true,
        photoOcclusalUpperId: true,
        photoOcclusalLowerId: true,
      },
    });
    const hasCompleteT0Set = t0 ? isCompleteSet(t0) : false;
    const guardError = requiresInitialPhotosBefore({
      from: currentPhase.phaseKey,
      to: parsed.data.toPhase,
      hasCompleteT0Set,
    });
    if (guardError) return fail(guardError);
  }

  const nextPhase = plan.phases.find((p) => p.phaseKey === parsed.data.toPhase);
  if (!nextPhase) return fail("Fase destino no inicializada en este plan");

  try {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.orthodonticPhase.update({
        where: { id: currentPhase.id },
        data: { status: "COMPLETED", completedAt: now },
      });
      await tx.orthodonticPhase.update({
        where: { id: nextPhase.id },
        data: {
          status: "IN_PROGRESS",
          startedAt: now,
          notes: parsed.data.notes ?? nextPhase.notes,
        },
      });

      // Si entramos a RETENTION, opcionalmente marcar status = RETENTION en el plan.
      if (parsed.data.toPhase === "RETENTION") {
        await tx.orthodonticTreatmentPlan.update({
          where: { id: plan.id },
          data: { status: "RETENTION", statusUpdatedAt: now },
        });
      }

      if (parsed.data.treatmentSessionId) {
        await linkSessionToPlan(
          {
            clinicId: ctx.clinicId,
            module: "orthodontics",
            moduleEntityType: "ortho-phase",
            moduleSessionId: currentPhase.id,
            treatmentSessionId: parsed.data.treatmentSessionId,
            linkedBy: ctx.userId,
            notes: `Fase ${currentPhase.phaseKey} completada`,
          },
          tx,
        );
      }
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.PHASE_ADVANCED,
      entityType: "OrthodonticTreatmentPlan",
      entityId: plan.id,
      before: { phase: currentPhase.phaseKey },
      after: { phase: parsed.data.toPhase },
    });

    revalidatePath(`/dashboard/patients/${plan.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${plan.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ planId: plan.id, toPhase: parsed.data.toPhase });
  } catch (e) {
    console.error("[ortho] advanceTreatmentPhase failed:", e);
    return fail("No se pudo avanzar la fase");
  }
}
