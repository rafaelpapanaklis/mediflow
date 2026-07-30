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
 *   • lib/import/entities.ts      → enforcement de la importación masiva,
 *   • lib/admin/clientes.ts       → el KPI "Pacientes X/500" del CRM del admin
 *                                   (vía getPatientQuotaMany, ver abajo).
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
  return buildQuota(used, maxPatients);
}

/**
 * La REGLA del cupo, en un solo lugar: la comparten getPatientQuota (una clínica)
 * y getPatientQuotaMany (varias). Si mañana cambia el criterio de canCreate, hay
 * un único sitio que tocar.
 */
function buildQuota(used: number, maxPatients: number | null): PatientQuota {
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

/**
 * Cupo de VARIAS clínicas de un tirón → `{ [clinicId]: PatientQuota }`.
 *
 * Existe para el CRM del admin (/admin/clientes), que necesita el cupo de todas
 * las clínicas de la lista y de todas las sedes de un cliente: llamar
 * getPatientQuota en un Promise.all sería 2 queries POR clínica (el patrón N+1
 * que el propio scanner del repo marca — ver bug-audit/scanners/performance.ts).
 * Aquí son 2 queries en total, sin importar cuántas clínicas entren, y los topes
 * salen de la caché de plan_configs (una lectura por plan distinto, ≤3).
 *
 * MISMO criterio que getPatientQuota — `deletedAt: null` y buildQuota — porque
 * el número del admin tiene que coincidir EXACTO con el chip que ve la clínica.
 * Las clínicas que no existen simplemente no aparecen en el resultado.
 */
export async function getPatientQuotaMany(
  clinicIds: string[],
): Promise<Record<string, PatientQuota>> {
  const out: Record<string, PatientQuota> = {};
  const ids: string[] = [];
  clinicIds.forEach((id) => {
    if (id && ids.indexOf(id) < 0) ids.push(id);
  });
  if (ids.length === 0) return out;

  const [clinics, grouped] = await Promise.all([
    prisma.clinic.findMany({ where: { id: { in: ids } }, select: { id: true, plan: true } }),
    prisma.patient.groupBy({
      by: ["clinicId"],
      where: { clinicId: { in: ids }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  // Una clínica sin pacientes no sale del groupBy → consumo 0, no "sin cupo".
  const usedByClinic: Record<string, number> = {};
  grouped.forEach((g) => {
    usedByClinic[g.clinicId] = g._count._all;
  });

  const maxByPlan: Record<string, number | null> = {};
  for (const c of clinics) {
    if (!(c.plan in maxByPlan)) maxByPlan[c.plan] = (await getPlanLimits(c.plan)).maxPatients;
    out[c.id] = buildQuota(usedByClinic[c.id] || 0, maxByPlan[c.plan]);
  }
  return out;
}
