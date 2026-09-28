// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026).
// Auth para las actions que llama el PORTAL DEL PACIENTE (no personal de la
// clínica): sesión de `patient_session`, no la sesión de staff que usa
// `getOrthoActionContext`. Nunca confía en un clinicId/patientId que mande
// el cliente: los resuelve del vínculo cuenta↔paciente + del caso mismo.

import { prisma } from "@/lib/prisma";
import { getPatientPortalContext } from "@/lib/patient-portal/guard";
import { fail, type ActionResult } from "../result";

export interface OrthoPatientPortalContext {
  patientId: string;
  clinicId: string;
  treatmentPlanId: string;
}

export function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function getOrthoPatientPortalContext(
  treatmentPlanId: string,
): Promise<ActionResult<OrthoPatientPortalContext>> {
  const portal = await getPatientPortalContext();
  if (!portal) return fail("No autenticado");

  const plan = await prisma.orthodonticTreatmentPlan.findUnique({
    where: { id: treatmentPlanId },
    select: { id: true, clinicId: true, patientId: true, deletedAt: true },
  });
  if (!plan || plan.deletedAt) return fail("Caso no encontrado");

  const linked = portal.links.some(
    (l) => l.patientId === plan.patientId && l.clinicId === plan.clinicId,
  );
  if (!linked) return fail("Sin acceso a este caso");

  return { ok: true, data: { patientId: plan.patientId, clinicId: plan.clinicId, treatmentPlanId } };
}
