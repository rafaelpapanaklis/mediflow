import "server-only";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import type { PatientQuota } from "@/lib/patient-quota-shared";

/**
 * CUPO DE PACIENTES — FUENTE ÚNICA de "¿cuántos pacientes tiene esta clínica y
 * cuántos le permite su plan?". La consumen las TRES superficies del tema:
 *
 *   • GET  /api/patients?v=2      → el contador "X/N pacientes" de la lista,
 *   • POST /api/patients          → enforcement al crear (402 PLAN_LIMIT_PATIENTS),
 *   • lib/import/entities.ts      → enforcement de la importación masiva.
 *
 * Que las tres pasen por aquí es lo que garantiza que el chip y el bloqueo
 * JAMÁS discrepen (antes cada punto contaba por su cuenta y con otro criterio).
 * Nadie más debe contar pacientes para decidir cupo.
 *
 * El tope sale de `plan_configs.maxPatients` vía getPlanLimits (caché 60s +
 * fallback), NUNCA de una constante: el admin lo edita sin redeploy y
 * `null` = ILIMITADO.
 */
export type { PatientQuota } from "@/lib/patient-quota-shared";

/**
 * DECISIÓN: el consumo EXCLUYE a los pacientes borrados (`deletedAt: null`).
 *
 * `Patient.deletedAt` es el borrado lógico de la cancelación ARCO (LFPDPPP): la
 * fila se conserva por NOM-024 pero el paciente ya no existe para la clínica.
 * Hacerlo consumir cupo sería cobrar por un expediente que nadie puede ver, y
 * dejaría al contador (480/500) peleado con el bloqueo. Ojo: los ARCHIVADOS
 * (status = "ARCHIVED", que es lo que hace el botón "Eliminar" por defecto) SÍ
 * cuentan — siguen siendo pacientes de la clínica, sólo fuera de la vista activa.
 */
export async function getPatientQuota(clinicId: string): Promise<PatientQuota> {
  const [clinic, used] = await Promise.all([
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { plan: true } }),
    prisma.patient.count({ where: { clinicId, deletedAt: null } }),
  ]);

  const { maxPatients } = await getPlanLimits(clinic?.plan);

  // Plan sin tope: ni contador ni bloqueo en ninguna superficie.
  if (maxPatients == null) {
    return { used, max: null, remaining: null, unlimited: true, canCreate: true };
  }

  // remaining nunca es negativo: una clínica puede quedar POR ENCIMA del tope
  // (bajó de plan, o el admin recortó maxPatients) y el contador debe decir
  // "520/500" sin que el resto de la UI haga cuentas raras.
  const remaining = Math.max(0, maxPatients - used);
  return { used, max: maxPatients, remaining, unlimited: false, canCreate: remaining > 0 };
}
