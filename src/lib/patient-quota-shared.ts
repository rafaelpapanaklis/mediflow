/**
 * Núcleo PURO y client-safe del cupo de PACIENTES.
 *
 * Sólo tipos y umbrales: sin prisma ni "server-only", así la lista de
 * /dashboard/patients (client component) puede tipar y colorear lo que le baja
 * `GET /api/patients?v=2`. La REGLA vive en `@/lib/patient-quota` (server), que
 * re-exporta estos tipos. Mismo patrón que branches-shared.ts ↔ branches.ts y
 * plan-shared.ts ↔ plans.ts.
 */

export interface PatientQuota {
  /** Pacientes vivos de la clínica (NO cuenta los borrados: deletedAt != null). */
  used: number;
  /** Tope del plan de la clínica; null = ILIMITADO (no se muestra ni se bloquea). */
  max: number | null;
  /** Cuántos más caben; null si es ilimitado. Nunca negativo. */
  remaining: number | null;
  /** max == null. Atajo para no repetir la comparación en cada superficie. */
  unlimited: boolean;
  /** false SOLO si el plan tiene tope y ya no queda lugar. */
  canCreate: boolean;
}

/** Desde qué proporción de consumo el contador pasa a color de advertencia. */
export const PATIENT_QUOTA_WARN_RATIO = 0.8;

/**
 * Cupo AGREGADO de varias clínicas — multi-sede del CRM del admin, donde un
 * mismo cliente puede ser dueño de varias clínicas y CADA UNA tiene su plan.
 *
 * Reglas (para que el KPI agregado no mienta):
 *  • Si CUALQUIER sede es ilimitada, el agregado es ilimitado: sumarle un "sin
 *    tope" a los topes daría un número inventado ("25/500" cuando una de esas
 *    clínicas es PRO y no tiene límite alguno) → se muestra sin "/N".
 *  • `remaining` suma los remanentes POR SEDE, no `max − used` del agregado: una
 *    sede por encima de su tope aporta 0 y no un crédito negativo que taparía el
 *    hueco de otra. Los pacientes no se mueven de sede, así que el cupo libre
 *    real es la suma de los libres de cada una.
 *  • Sin sedes → sin tope que mostrar (nunca "0/0").
 */
export function aggregatePatientQuotas(quotas: PatientQuota[]): PatientQuota {
  const used = quotas.reduce((s, q) => s + q.used, 0);
  const anyUnlimited = quotas.some((q) => q.unlimited || q.max == null);
  if (quotas.length === 0 || anyUnlimited) {
    return { used, max: null, remaining: null, unlimited: true, canCreate: true };
  }
  const max = quotas.reduce((s, q) => s + (q.max as number), 0);
  const remaining = quotas.reduce((s, q) => s + (q.remaining ?? 0), 0);
  return { used, max, remaining, unlimited: false, canCreate: remaining > 0 };
}

/**
 * Texto del consumo: "15/500", o sólo "15" si el plan es ilimitado. Mismo
 * formato que el chip de /dashboard/patients (patients.toolbar.quotaChip) para
 * que el admin y la clínica se lean igual. Locale fijo es-MX: los separadores de
 * miles deben ser idénticos en SSR y en el cliente (si no, hidratación rota).
 */
export function formatPatientQuota(quota: PatientQuota): string {
  const used = quota.used.toLocaleString("es-MX");
  if (quota.unlimited || quota.max == null) return used;
  return `${used}/${quota.max.toLocaleString("es-MX")}`;
}

/** Semáforo del contador: normal → advertencia (≥80%) → lleno (100%). */
export type PatientQuotaLevel = "ok" | "warn" | "full";

/**
 * Nivel visual del cupo. FUENTE ÚNICA del umbral: si mañana cambia el 80%,
 * cambia aquí y todas las superficies lo siguen.
 */
export function patientQuotaLevel(quota: PatientQuota): PatientQuotaLevel {
  if (quota.unlimited || quota.max == null) return "ok";
  // "Lleno" antes que cualquier otra cosa: manda el mismo dato que decide el
  // bloqueo, así el color no puede contradecir al botón deshabilitado (incluye
  // el caso tope = 0, donde la división de abajo no diría nada útil).
  if (!quota.canCreate) return "full";
  if (quota.max <= 0) return "ok";
  return quota.used / quota.max >= PATIENT_QUOTA_WARN_RATIO ? "warn" : "ok";
}
