// Ortodoncia — Parte 8 «Alineadores y cumplimiento» (ws1-t8, ola 1, sep-2026).
// Auth para las actions que llama el PORTAL DEL PACIENTE (no personal de la
// clínica): sesión de `patient_session`, no la sesión de staff que usa
// `getOrthoActionContext`. Nunca confía en un clinicId/patientId que mande
// el cliente: los resuelve del vínculo cuenta↔paciente + del caso mismo.
//
// ws1-t5 (ronda 6, fila 16 del mapa): las dos acciones ESCRIBEN, y un caso
// terminado o una clínica con el módulo apagado seguían aceptando registros
// y fotos que nadie iba a revisar. Con `{ escritura: true }` se exige caso
// abierto y módulo activo; leer el caso no pasa por aquí. Devuelve además la
// zona horaria de la clínica: el día del registro se calcula con ella.

import { prisma } from "@/lib/prisma";
import { getPatientPortalContext } from "@/lib/patient-portal/guard";
import { hasActiveOrthodonticsModule } from "@/lib/orthodontics/access";
import { permisosDelCaso } from "@/lib/patient-portal/ortodoncia-portal";
import { fail, type ActionResult } from "../result";

export interface OrthoPatientPortalContext {
  patientId: string;
  clinicId: string;
  treatmentPlanId: string;
  /** IANA de la clínica del caso (`clinics.timezone`). */
  zonaHoraria: string;
  /** Estado del caso (`OrthoTreatmentStatus`). */
  estado: string;
}

export function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
}

export async function getOrthoPatientPortalContext(
  treatmentPlanId: string,
  opts: { escritura?: boolean } = {},
): Promise<ActionResult<OrthoPatientPortalContext>> {
  const portal = await getPatientPortalContext();
  if (!portal) return fail("No autenticado");
  if (!treatmentPlanId) return fail("Caso no encontrado");

  const plan = await prisma.orthodonticTreatmentPlan.findUnique({
    where: { id: treatmentPlanId },
    select: {
      id: true,
      clinicId: true,
      patientId: true,
      deletedAt: true,
      status: true,
      clinic: { select: { timezone: true } },
    },
  });
  if (!plan || plan.deletedAt) return fail("Caso no encontrado");

  const linked = portal.links.some(
    (l) => l.patientId === plan.patientId && l.clinicId === plan.clinicId,
  );
  if (!linked) return fail("Sin acceso a este caso");

  if (opts.escritura) {
    const moduloActivo = await hasActiveOrthodonticsModule(plan.clinicId);
    const permisos = permisosDelCaso(plan.status, moduloActivo);
    if (permisos.soloLectura) return fail(permisos.aviso ?? "Este caso es de solo lectura.");
  }

  return {
    ok: true,
    data: {
      patientId: plan.patientId,
      clinicId: plan.clinicId,
      treatmentPlanId,
      zonaHoraria: plan.clinic.timezone,
      estado: plan.status,
    },
  };
}
