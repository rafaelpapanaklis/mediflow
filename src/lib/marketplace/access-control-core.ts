/**
 * Lógica pura de control de acceso a módulos. Sin Prisma — fácil de
 * testear y reutilizable en server components que ya tengan los datos.
 *
 * El wrapper que lee de DB vive en ./access-control.ts.
 */
import { isInTrial } from "@/lib/plan-status";

export type ModuleAccessReason =
  | "trial"           // dentro de los 14 días de trial
  | "purchased"       // módulo comprado y activo
  | "expired"         // comprado pero currentPeriodEnd ya pasó (o status != active)
  | "not_purchased"   // post-trial sin compra de este módulo
  | "unknown_clinic"; // clinicId no existe

export interface ModuleAccess {
  hasAccess: boolean;
  reason: ModuleAccessReason;
}

/** Subset de los datos de la clínica necesarios para decidir acceso. */
export interface ClinicAccessSnapshot {
  trialEndsAt: Date;
  /**
   * Sin él, la fecha sola decide (trial legado). Con suscripción viva
   * (active/trialing/paid) la clínica NO está en trial aunque trialEndsAt
   * esté en el futuro: para quien paga, trialEndsAt es el fin del periodo
   * pagado (= nextBillingDate), no un trial. Ver src/lib/plan-status.ts.
   */
  subscriptionStatus?: string | null;
  modules: Array<{
    moduleKey: string;
    status: string;          // "active" | "trial" | "paused" | "cancelled"
    currentPeriodEnd: Date;
  }>;
}

/**
 * Decisión pura sin I/O. Recibe un snapshot ya cargado y devuelve si la
 * clínica puede acceder al módulo. Inyecta `now` para tests.
 *
 * Política:
 *   - Durante trial/cortesía VIGENTE (isInTrial: periodo por delante y SIN
 *     suscripción viva): acceso a TODO.
 *   - Si no: solo si ClinicModule.status === 'active' && currentPeriodEnd > now.
 *     Una clínica que PAGA cae aquí desde el primer día: su trialEndsAt es el
 *     fin del periodo pagado, no un trial (antes la fecha sola le abría todo
 *     el marketplace durante su primer mes).
 */
export function evaluateAccess(
  snapshot: ClinicAccessSnapshot | null,
  moduleKey: string,
  now: Date = new Date(),
): ModuleAccess {
  if (!snapshot) {
    return { hasAccess: false, reason: "unknown_clinic" };
  }

  if (isInTrial(snapshot, now)) {
    return { hasAccess: true, reason: "trial" };
  }

  const cm = snapshot.modules.find((m) => m.moduleKey === moduleKey);
  if (!cm) {
    return { hasAccess: false, reason: "not_purchased" };
  }

  const isActive = cm.status === "active" && cm.currentPeriodEnd > now;
  return {
    hasAccess: isActive,
    reason: isActive ? "purchased" : "expired",
  };
}
