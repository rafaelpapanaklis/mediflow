// Periodontics — server action: sesión de raspado y alisado radicular. SPEC §5.2

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createSRPSessionSchema } from "@/lib/periodontics/schemas";
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
 * Registra una sesión de SRP. `quadrantsCompleted` es un JSON con un objeto
 * por cuadrante (Q1..Q4) con `{ completed, completedAt, notes }`.
 *
 * El doctor puede registrar técnica `FULL_MOUTH_DISINFECTION` (todos los
 * cuadrantes en una sola sesión) o `SRP_CUADRANTE` (sesiones separadas).
 */
export async function createSRPSession(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getPerioActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createSRPSessionSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForPerio({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  const plan = await prisma.periodontalTreatmentPlan.findFirst({
    where: { id: parsed.data.planId, clinicId: ctx.clinicId, deletedAt: null },
    select: { id: true, patientId: true },
  });
  if (!plan || plan.patientId !== parsed.data.patientId) {
    return fail("Plan no encontrado o no corresponde al paciente");
  }

  try {
    const created = await prisma.sRPSession.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        planId: parsed.data.planId,
        doctorId: ctx.userId,
        technique: parsed.data.technique,
        instrumentation: parsed.data.instrumentation,
        quadrantsCompleted: parsed.data.quadrantsCompleted,
        anesthesiaUsed: parsed.data.anesthesiaUsed,
        anesthesiaType: parsed.data.anesthesiaType ?? null,
        durationMinutes: parsed.data.durationMinutes ?? null,
        observations: parsed.data.observations ?? null,
      },
      select: { id: true, technique: true },
    });

    await auditPerio({
      ctx,
      action: PERIO_AUDIT_ACTIONS.SRP_SESSION_CREATED,
      entityType: "SRPSession",
      entityId: created.id,
      after: {
        technique: created.technique,
        instrumentation: parsed.data.instrumentation,
        quadrants: Object.entries(parsed.data.quadrantsCompleted)
          .filter(([, v]) => v.completed)
          .map(([k]) => k),
      },
    });

    revalidatePath(`/dashboard/specialties/periodontics/${parsed.data.patientId}`);
    return ok({ id: created.id });
  } catch (e) {
    console.error("[perio srp] create failed:", e);
    return fail("No se pudo registrar la sesión SRP");
  }
}
