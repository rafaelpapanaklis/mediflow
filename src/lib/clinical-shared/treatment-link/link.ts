// Clinical-shared — primitiva linkSessionToPlan().
//
// Une una sesión específica de un módulo (eg. un Sealant aplicado, una
// FluorideApplication) con una TreatmentSession del plan general
// (TreatmentPlan). Crea un TreatmentLink y marca la TreatmentSession
// como completada (completedAt = now()).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ClinicalModule } from "@prisma/client";

export interface LinkSessionArgs {
  clinicId: string;
  module: ClinicalModule;
  /** Identificador lógico del registro en su módulo (eg. "ped-sealant"). */
  moduleEntityType: string;
  /** ID del registro del módulo (eg. el sealant.id recién creado). */
  moduleSessionId: string;
  /** ID de TreatmentSession a marcar como completada. */
  treatmentSessionId: string;
  linkedBy: string;
  notes?: string | null;
}

export interface LinkSessionResult {
  linkId: string;
  treatmentSessionId: string;
  alreadyLinked: boolean;
}

/**
 * Crea (o reutiliza) el TreatmentLink y marca la TreatmentSession como
 * completada. Idempotente: si el link ya existe (mismo entityType +
 * moduleSessionId + treatmentSessionId), retorna alreadyLinked=true sin
 * duplicar el row ni sobreescribir completedAt.
 *
 * Acepta un cliente Prisma transaccional opcional para que las acciones
 * que llaman dentro de una transacción puedan reusarla.
 */
export async function linkSessionToPlan(
  args: LinkSessionArgs,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<LinkSessionResult> {
  // Validar tenant: la TreatmentSession pertenece a un TreatmentPlan
  // cuya clinicId debe coincidir con args.clinicId.
  const session = await client.treatmentSession.findUnique({
    where: { id: args.treatmentSessionId },
    select: {
      id: true,
      completedAt: true,
      treatment: { select: { clinicId: true } },
    },
  });
  if (!session) throw new Error("TreatmentSession no encontrada");
  if (session.treatment.clinicId !== args.clinicId) {
    throw new Error("Session no pertenece al clinicId");
  }

  const existing = await client.treatmentLink.findUnique({
    where: {
      moduleEntityType_moduleSessionId_treatmentSessionId: {
        moduleEntityType: args.moduleEntityType,
        moduleSessionId: args.moduleSessionId,
        treatmentSessionId: args.treatmentSessionId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return {
      linkId: existing.id,
      treatmentSessionId: session.id,
      alreadyLinked: true,
    };
  }

  const link = await client.treatmentLink.create({
    data: {
      clinicId: args.clinicId,
      module: args.module,
      moduleEntityType: args.moduleEntityType,
      moduleSessionId: args.moduleSessionId,
      treatmentSessionId: args.treatmentSessionId,
      linkedBy: args.linkedBy,
      notes: args.notes ?? null,
    },
    select: { id: true },
  });

  if (!session.completedAt) {
    await client.treatmentSession.update({
      where: { id: session.id },
      data: { completedAt: new Date() },
    });
  }

  return {
    linkId: link.id,
    treatmentSessionId: session.id,
    alreadyLinked: false,
  };
}

/**
 * Devuelve los links existentes para una entity (eg. todos los planes
 * que ya cubren un Sealant específico). Útil para mostrar el badge.
 */
export async function findLinksFor(args: {
  clinicId: string;
  moduleEntityType: string;
  moduleSessionId: string;
}): Promise<
  Array<{
    linkId: string;
    treatmentSessionId: string;
    treatmentPlanId: string;
    sessionNumber: number;
  }>
> {
  const links = await prisma.treatmentLink.findMany({
    where: {
      clinicId: args.clinicId,
      moduleEntityType: args.moduleEntityType,
      moduleSessionId: args.moduleSessionId,
      deletedAt: null,
    },
    include: {
      treatmentSession: {
        select: { id: true, sessionNumber: true, treatmentId: true },
      },
    },
  });
  return links.map((l) => ({
    linkId: l.id,
    treatmentSessionId: l.treatmentSession.id,
    treatmentPlanId: l.treatmentSession.treatmentId,
    sessionNumber: l.treatmentSession.sessionNumber,
  }));
}
