"use server";
// Clinical-shared — server actions para TreatmentLink.

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ClinicalModule } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthContext } from "@/lib/auth-context";
import { auditClinicalShared } from "@/lib/clinical-shared/auth/guard";
import { linkSessionToPlan, findLinksFor } from "@/lib/clinical-shared/treatment-link/link";
import { fail, ok, type ActionResult } from "@/lib/clinical-shared/result";

const moduleEnum = z.nativeEnum(ClinicalModule);

const linkSchema = z.object({
  module: moduleEnum,
  moduleEntityType: z.string().min(1).max(60),
  moduleSessionId: z.string().min(1),
  treatmentSessionId: z.string().min(1),
  notes: z.string().max(500).optional(),
});

export async function linkSessionToTreatmentPlan(
  input: z.infer<typeof linkSchema>,
): Promise<ActionResult<{ linkId: string; alreadyLinked: boolean }>> {
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  try {
    const result = await linkSessionToPlan({
      clinicId: ctx.clinicId,
      module: parsed.data.module,
      moduleEntityType: parsed.data.moduleEntityType,
      moduleSessionId: parsed.data.moduleSessionId,
      treatmentSessionId: parsed.data.treatmentSessionId,
      linkedBy: ctx.userId,
      notes: parsed.data.notes ?? null,
    });
    if (!result.alreadyLinked) {
      await auditClinicalShared({
        ctx,
        action: "clinical-shared.treatment-link.created",
        entityType: "treatment-link",
        entityId: result.linkId,
        changes: {
          module: parsed.data.module,
          entityType: parsed.data.moduleEntityType,
        },
      });
    }
    revalidatePath("/dashboard");
    return ok({ linkId: result.linkId, alreadyLinked: result.alreadyLinked });
  } catch (e) {
    return fail((e as Error).message);
  }
}

const findSchema = z.object({
  moduleEntityType: z.string().min(1),
  moduleSessionId: z.string().min(1),
});

export async function findTreatmentLinksFor(
  input: z.infer<typeof findSchema>,
): Promise<
  ActionResult<
    Array<{
      linkId: string;
      treatmentSessionId: string;
      treatmentPlanId: string;
      sessionNumber: number;
    }>
  >
> {
  const parsed = findSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const links = await findLinksFor({
    clinicId: ctx.clinicId,
    moduleEntityType: parsed.data.moduleEntityType,
    moduleSessionId: parsed.data.moduleSessionId,
  });
  return ok(links);
}

const listOpenSessionsSchema = z.object({
  patientId: z.string().min(1),
});

export async function listOpenTreatmentSessions(
  input: z.infer<typeof listOpenSessionsSchema>,
): Promise<
  ActionResult<
    Array<{
      treatmentSessionId: string;
      treatmentPlanId: string;
      planName: string;
      sessionNumber: number;
    }>
  >
> {
  const parsed = listOpenSessionsSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos");
  const ctx = await getAuthContext();
  if (!ctx) return fail("No autenticado");

  const sessions = await prisma.treatmentSession.findMany({
    where: {
      completedAt: null,
      treatment: {
        clinicId: ctx.clinicId,
        patientId: parsed.data.patientId,
        status: "ACTIVE",
      },
    },
    select: {
      id: true,
      sessionNumber: true,
      treatment: { select: { id: true, name: true } },
    },
    orderBy: { sessionNumber: "asc" },
  });

  return ok(
    sessions.map((s) => ({
      treatmentSessionId: s.id,
      treatmentPlanId: s.treatment.id,
      planName: s.treatment.name,
      sessionNumber: s.sessionNumber,
    })),
  );
}
