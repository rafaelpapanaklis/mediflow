// Periodontics — server actions: TreatmentLink hooks (cierre SRP / reeval / cirugía).
// SPEC §5, COMMIT 6.
//
// Cuando se "completa" una sesión perio (SRP, reevaluación, cirugía) se la
// liga opcionalmente a una TreatmentSession del plan general del paciente
// y se marca esa session como completada.
//
// El link es polimórfico: TreatmentLink.moduleEntityType identifica el tipo
// de sesión perio. Sin foreign key al moduleSessionId — la consistencia se
// garantiza acá.

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  auditPerio,
  fail,
  getPerioActionContext,
  isFailure,
  loadPatientForPerio,
  ok,
  type ActionResult,
} from "./_helpers";
import {
  PERIO_TREATMENT_LINK_ENTITY,
  type PerioTreatmentLinkEntity,
} from "@/lib/periodontics/treatment-link-keys";

// ─────────────────────────────────────────────────────────────────────
// Helpers privados
// ─────────────────────────────────────────────────────────────────────

const completeSchema = z.object({
  patientId: z.string().min(1),
  sessionId: z.string().min(1),
  treatmentSessionId: z.string().min(1).optional(),
  notes: z.string().max(500).optional(),
});

interface VerifierArgs {
  clinicId: string;
  patientId: string;
  sessionId: string;
}

async function verifySrp(args: VerifierArgs) {
  return prisma.sRPSession.findFirst({
    where: {
      id: args.sessionId,
      clinicId: args.clinicId,
      patientId: args.patientId,
    },
    select: { id: true },
  });
}

async function verifyReevaluation(args: VerifierArgs) {
  return prisma.periodontalReevaluation.findFirst({
    where: {
      id: args.sessionId,
      clinicId: args.clinicId,
      patientId: args.patientId,
    },
    select: { id: true },
  });
}

async function verifySurgery(args: VerifierArgs) {
  return prisma.periodontalSurgery.findFirst({
    where: {
      id: args.sessionId,
      clinicId: args.clinicId,
      patientId: args.patientId,
      deletedAt: null,
    },
    select: { id: true },
  });
}

const VERIFIERS: Record<
  PerioTreatmentLinkEntity,
  (args: VerifierArgs) => Promise<{ id: string } | null>
> = {
  [PERIO_TREATMENT_LINK_ENTITY.SRP]: verifySrp,
  [PERIO_TREATMENT_LINK_ENTITY.REEVALUATION]: verifyReevaluation,
  [PERIO_TREATMENT_LINK_ENTITY.SURGERY]: verifySurgery,
};

const AUDIT_ACTIONS: Record<PerioTreatmentLinkEntity, string> = {
  [PERIO_TREATMENT_LINK_ENTITY.SRP]: "perio.srp.completed",
  [PERIO_TREATMENT_LINK_ENTITY.REEVALUATION]: "perio.reevaluation.completed",
  [PERIO_TREATMENT_LINK_ENTITY.SURGERY]: "perio.surgery.completed",
};

interface CompleteResult {
  id: string;
  treatmentLinkId: string | null;
  treatmentSessionCompleted: boolean;
}

async function completeAndLink(
  entity: PerioTreatmentLinkEntity,
  input: unknown,
): Promise<ActionResult<CompleteResult>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");
  }

  const patient = await loadPatientForPerio({
    ctx,
    patientId: parsed.data.patientId,
  });
  if (isFailure(patient)) return patient;

  const session = await VERIFIERS[entity]({
    clinicId: ctx.clinicId,
    patientId: parsed.data.patientId,
    sessionId: parsed.data.sessionId,
  });
  if (!session) return fail("Sesión perio no encontrada");

  let treatmentLinkId: string | null = null;
  let treatmentSessionCompleted = false;

  if (parsed.data.treatmentSessionId) {
    // Verificar que la TreatmentSession pertenezca a un plan del mismo
    // paciente y clínica. Nota: TreatmentSession no tiene clinicId/patientId
    // directo — se valida vía el plan padre.
    const tSession = await prisma.treatmentSession.findFirst({
      where: { id: parsed.data.treatmentSessionId },
      select: {
        id: true,
        completedAt: true,
        treatment: { select: { clinicId: true, patientId: true } },
      },
    });
    if (
      !tSession ||
      tSession.treatment.clinicId !== ctx.clinicId ||
      tSession.treatment.patientId !== parsed.data.patientId
    ) {
      return fail("Sesión de tratamiento inválida para este paciente");
    }

    try {
      // Idempotente: upsert por @@unique compound. Si ya existe, lo
      // devuelve sin error.
      const link = await prisma.treatmentLink.upsert({
        where: {
          moduleEntityType_moduleSessionId_treatmentSessionId: {
            moduleEntityType: entity,
            moduleSessionId: session.id,
            treatmentSessionId: tSession.id,
          },
        },
        update: { notes: parsed.data.notes ?? null, deletedAt: null },
        create: {
          clinicId: ctx.clinicId,
          module: "periodontics",
          moduleEntityType: entity,
          moduleSessionId: session.id,
          treatmentSessionId: tSession.id,
          linkedBy: ctx.userId,
          notes: parsed.data.notes ?? null,
        },
        select: { id: true },
      });
      treatmentLinkId = link.id;

      if (!tSession.completedAt) {
        await prisma.treatmentSession.update({
          where: { id: tSession.id },
          data: { completedAt: new Date() },
        });
        treatmentSessionCompleted = true;
      }
    } catch (e) {
      console.error("[perio treatment-link]", entity, "failed:", e);
      return fail("No se pudo enlazar la sesión de tratamiento");
    }
  }

  await auditPerio({
    ctx,
    action: AUDIT_ACTIONS[entity],
    entityType: entity,
    entityId: session.id,
    after: {
      treatmentSessionId: parsed.data.treatmentSessionId ?? null,
      treatmentLinkId,
      treatmentSessionCompleted,
    },
  });

  revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
  return ok({
    id: session.id,
    treatmentLinkId,
    treatmentSessionCompleted,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Server actions exportados (3 hooks)
// ─────────────────────────────────────────────────────────────────────

export async function completeSrpSession(
  input: unknown,
): Promise<ActionResult<CompleteResult>> {
  return completeAndLink(PERIO_TREATMENT_LINK_ENTITY.SRP, input);
}

export async function completeReevaluation(
  input: unknown,
): Promise<ActionResult<CompleteResult>> {
  return completeAndLink(PERIO_TREATMENT_LINK_ENTITY.REEVALUATION, input);
}

export async function completePeriSurgery(
  input: unknown,
): Promise<ActionResult<CompleteResult>> {
  return completeAndLink(PERIO_TREATMENT_LINK_ENTITY.SURGERY, input);
}
