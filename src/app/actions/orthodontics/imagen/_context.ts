// Ortodoncia — Parte 7/8 «Imagen y análisis» (ws1-t8, ola 1, sep-2026).
// Helper local a esta parte — NO se toca `../_helpers.ts` (exclusivo de
// «Acceso y permisos»). Reusa `getOrthoActionContext` de ahí (import de
// solo lectura) y resuelve el resto localmente a partir de un
// `treatmentPlanId`, que es lo que reciben las ranuras de esta parte
// (mismo patrón que `ResumenCobranza` de la Ola 0).

import { prisma } from "@/lib/prisma";
import type { AuthContext } from "@/lib/auth-context";
import { getOrthoActionContext } from "../_helpers";
import { fail, isFailure, type ActionResult } from "../result";

export interface OrthoImagingContext {
  ctx: AuthContext;
  treatmentPlanId: string;
  patientId: string;
}

/** Códigos Prisma de "tabla/columna inexistente" — SQL de esta parte aún no pegado en dev.108. */
export function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

/**
 * Auth + módulo activo + resolver el `patientId` del caso, verificando que
 * pertenece a la clínica de la sesión. Una sola llamada por action.
 */
export async function getOrthoImagingContext(
  treatmentPlanId: string,
  opts?: { write?: boolean },
): Promise<ActionResult<OrthoImagingContext>> {
  const auth = await getOrthoActionContext(opts);
  if (isFailure(auth)) return auth;
  const { ctx } = auth.data;

  const plan = await prisma.orthodonticTreatmentPlan.findUnique({
    where: { id: treatmentPlanId },
    select: { id: true, clinicId: true, patientId: true, deletedAt: true },
  });
  if (!plan || plan.deletedAt) return fail("Caso de ortodoncia no encontrado");
  if (plan.clinicId !== ctx.clinicId) return fail("Sin acceso a este caso");

  return { ok: true, data: { ctx, treatmentPlanId, patientId: plan.patientId } };
}
