/**
 * Lógica pura de control de acceso a módulos. Sin Prisma — fácil de
 * testear y reutilizable en server components que ya tengan los datos.
 *
 * El wrapper que lee de DB vive en ./access-control.ts.
 */

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
 *   - Durante trial (now < trialEndsAt): acceso a TODO.
 *   - Post-trial: solo si ClinicModule.status === 'active' &&
 *     currentPeriodEnd > now.
 */
export function evaluateAccess(
  snapshot: ClinicAccessSnapshot | null,
  moduleKey: string,
  now: Date = new Date(),
): ModuleAccess {
  if (!snapshot) {
    return { hasAccess: false, reason: "unknown_clinic" };
  }

  if (now < snapshot.trialEndsAt) {
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
