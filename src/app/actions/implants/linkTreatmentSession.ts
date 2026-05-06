"use server";
// Implants — TreatmentLink. Une una fase del implante (surgical / healing /
// second_stage / prosthetic / follow_up) con una TreatmentSession del plan
// de tratamiento general, y marca esa session como completada.
//
// Spec: cuando una fase clínica completa (createSurgicalRecord,
// createProstheticPhase, etc.) se invoca este hook con el id del registro
// específico y el id de la TreatmentSession asociada del plan.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  isImplantTreatmentLinkPhase,
  implantPhaseToModuleEntityType,
  type ImplantTreatmentLinkPhase,
} from "@/lib/clinical-shared/treatment-link";
import { getImplantActionContext } from "./_helpers";
import { fail, isFailure, ok, type ActionResult } from "./result";

export interface LinkImplantPhaseInput {
  /** Id del registro específico (eg. ImplantSurgicalRecord.id). */
  moduleSessionId: string;
  /** Fase implantológica que completa. */
  phase: ImplantTreatmentLinkPhase;
  /** TreatmentSession del plan de tratamiento general. */
  treatmentSessionId: string;
  /** Notas opcionales. */
  notes?: string | null;
}

export interface LinkImplantPhaseResult {
  treatmentLinkId: string;
  treatmentSessionId: string;
  /** True si esta llamada marcó la TreatmentSession como completada. */
  treatmentSessionMarkedCompleted: boolean;
}

/**
 * Vincula una fase implantológica con una TreatmentSession y marca la
 * session como completada (idempotente: si ya estaba completada, no la
 * sobrescribe; si ya existe el link, retorna el existente).
 */
export async function linkImplantPhaseToTreatmentSession(
  input: LinkImplantPhaseInput,
): Promise<ActionResult<LinkImplantPhaseResult>> {
  if (!isImplantTreatmentLinkPhase(input.phase)) {
    return fail(`Fase implantológica desconocida: ${input.phase}`);
  }

  const ctxRes = await getImplantActionContext();
  if (isFailure(ctxRes)) return ctxRes;
  const { ctx } = ctxRes.data;

  // Verifica que la TreatmentSession exista y pertenezca al tenant.
  const session = await prisma.treatmentSession.findUnique({
    where: { id: input.treatmentSessionId },
    select: {
      id: true,
      treatmentId: true,
      completedAt: true,
      treatment: { select: { clinicId: true, patientId: true } },
    },
  });
  if (!session) return fail("Sesión de tratamiento no encontrada");
  if (session.treatment.clinicId !== ctx.clinicId) {
    return fail("Sesión pertenece a otra clínica");
  }

  const moduleEntityType = implantPhaseToModuleEntityType(input.phase);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const link = await tx.treatmentLink.upsert({
        where: {
          moduleEntityType_moduleSessionId_treatmentSessionId: {
            moduleEntityType,
            moduleSessionId: input.moduleSessionId,
            treatmentSessionId: input.treatmentSessionId,
          },
        },
        create: {
          clinicId: ctx.clinicId,
          module: "implants",
          moduleEntityType,
          moduleSessionId: input.moduleSessionId,
          treatmentSessionId: input.treatmentSessionId,
          linkedBy: ctx.userId,
          notes: input.notes ?? null,
        },
        update: {}, // upsert idempotente
        select: { id: true },
      });

      // Si la session no estaba completada, márcala
      let marked = false;
      if (!session.completedAt) {
        await tx.treatmentSession.update({
          where: { id: input.treatmentSessionId },
          data: { completedAt: new Date() },
        });
        marked = true;
      }

      return {
        treatmentLinkId: link.id,
        treatmentSessionId: input.treatmentSessionId,
        treatmentSessionMarkedCompleted: marked,
      };
    });

    revalidatePath(`/dashboard/patients/${session.treatment.patientId}`);
    return ok(result);
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : "Error al vincular sesión",
    );
  }
}

/**
 * Hook de conveniencia — invocar al completar una fase quirúrgica.
 * No requiere treatmentSessionId; si no se provee, no hace nada.
 */
export async function onImplantSurgicalPhaseComplete(args: {
  surgicalRecordId: string;
  treatmentSessionId?: string | null;
}): Promise<ActionResult<LinkImplantPhaseResult | null>> {
  if (!args.treatmentSessionId) return ok(null);
  return linkImplantPhaseToTreatmentSession({
    moduleSessionId: args.surgicalRecordId,
    phase: "surgical",
    treatmentSessionId: args.treatmentSessionId,
  });
}

/**
 * Hook al completar una fase de cicatrización.
 */
export async function onImplantHealingComplete(args: {
  healingPhaseId: string;
  treatmentSessionId?: string | null;
}): Promise<ActionResult<LinkImplantPhaseResult | null>> {
  if (!args.treatmentSessionId) return ok(null);
  return linkImplantPhaseToTreatmentSession({
    moduleSessionId: args.healingPhaseId,
    phase: "healing",
    treatmentSessionId: args.treatmentSessionId,
  });
}

/**
 * Hook al completar la fase protésica (entrega de corona).
 */
export async function onImplantProstheticComplete(args: {
  prostheticPhaseId: string;
  treatmentSessionId?: string | null;
}): Promise<ActionResult<LinkImplantPhaseResult | null>> {
  if (!args.treatmentSessionId) return ok(null);
  return linkImplantPhaseToTreatmentSession({
    moduleSessionId: args.prostheticPhaseId,
    phase: "prosthetic",
    treatmentSessionId: args.treatmentSessionId,
  });
}
