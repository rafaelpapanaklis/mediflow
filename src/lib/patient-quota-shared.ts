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
