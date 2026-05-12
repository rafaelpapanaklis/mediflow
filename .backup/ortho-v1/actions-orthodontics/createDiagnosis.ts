"use server";
// Orthodontics — action 1/15: createDiagnosis. SPEC §5.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { createDiagnosisSchema } from "@/lib/validation/orthodontics";
import {
  auditOrtho,
  getOrthoActionContext,
  loadPatientForOrtho,
} from "./_helpers";
import { ORTHO_AUDIT_ACTIONS } from "./audit-actions";
import { fail, isFailure, ok, type ActionResult } from "./result";

export async function createDiagnosis(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const auth = await getOrthoActionContext();
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const parsed = createDiagnosisSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Datos inválidos");

  const patient = await loadPatientForOrtho({ ctx, patientId: parsed.data.patientId });
  if (isFailure(patient)) return patient;

  try {
    const created = await prisma.orthodonticDiagnosis.create({
      data: {
        patientId: parsed.data.patientId,
        clinicId: ctx.clinicId,
        diagnosedById: ctx.userId,
        angleClassRight: parsed.data.angleClassRight,
        angleClassLeft: parsed.data.angleClassLeft,
        overbiteMm: parsed.data.overbiteMm,
        overbitePercentage: parsed.data.overbitePercentage,
        overjetMm: parsed.data.overjetMm,
        midlineDeviationMm: parsed.data.midlineDeviationMm ?? null,
        crossbite: parsed.data.crossbite,
        crossbiteDetails: parsed.data.crossbiteDetails ?? null,
        openBite: parsed.data.openBite,
        openBiteDetails: parsed.data.openBiteDetails ?? null,
        crowdingUpperMm: parsed.data.crowdingUpperMm ?? null,
        crowdingLowerMm: parsed.data.crowdingLowerMm ?? null,
        etiologySkeletal: parsed.data.etiologySkeletal,
        etiologyDental: parsed.data.etiologyDental,
        etiologyFunctional: parsed.data.etiologyFunctional,
        etiologyNotes: parsed.data.etiologyNotes ?? null,
        habits: parsed.data.habits,
        habitsDescription: parsed.data.habitsDescription ?? null,
        dentalPhase: parsed.data.dentalPhase,
        tmjPainPresent: parsed.data.tmjPainPresent,
        tmjClickingPresent: parsed.data.tmjClickingPresent,
        tmjNotes: parsed.data.tmjNotes ?? null,
        initialPhotoSetId: parsed.data.initialPhotoSetId ?? null,
        initialCephFileId: parsed.data.initialCephFileId ?? null,
        initialScanFileId: parsed.data.initialScanFileId ?? null,
        clinicalSummary: parsed.data.clinicalSummary,
      },
      select: { id: true, angleClassRight: true, angleClassLeft: true },
    });

    await auditOrtho({
      ctx,
      action: ORTHO_AUDIT_ACTIONS.DIAGNOSIS_CREATED,
      entityType: "OrthodonticDiagnosis",
      entityId: created.id,
      after: {
        patientId: parsed.data.patientId,
        angleR: created.angleClassRight,
        angleL: created.angleClassLeft,
      },
    });

    revalidatePath(`/dashboard/patients/${parsed.data.patientId}/orthodontics`);
    revalidatePath(`/dashboard/specialties/orthodontics/${parsed.data.patientId}`);
    revalidatePath(`/dashboard/specialties/orthodontics`);

    return ok({ id: created.id });
  } catch (e) {
    console.error("[ortho] createDiagnosis failed:", e);
    return fail("No se pudo crear el diagnóstico");
  }
}
