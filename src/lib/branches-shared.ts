/**
 * Núcleo PURO y client-safe del cupo de SUCURSALES (Multi-Clínica Fase 1).
 *
 * Sólo tipos: sin prisma ni "server-only", así el sidebar (client) puede tipar
 * lo que le baja el layout. La REGLA vive en `@/lib/branches` (server), que
 * re-exporta estos tipos. Mismo patrón que plan-shared.ts ↔ plans.ts.
 */

/** Motivo por el que el dueño no puede crear otra sede (null = sí puede). */
export type BranchBlockedReason =
  /** No es SUPER_ADMIN en la clínica activa. */
  | "ROLE"
  /** El plan de la clínica activa no contempla multi-sucursal (maxClinics = 1). */
  | "PLAN"
  /** El plan lo permite, pero la suscripción de la clínica activa no está al día. */
  | "SUBSCRIPTION"
  /** Ya usó todas las sedes que incluye su plan. */
  | "LIMIT";

export interface BranchQuota {
  /** Clínicas donde este dueño es SUPER_ADMIN (incluye la activa). */
  used: number;
  /** Tope del plan de la clínica activa; null = ilimitado. */
  max: number | null;
  canCreate: boolean;
  /** El plan contempla multi-sucursal. Si es false, no mostramos nada del tema. */
  planAllowsBranches: boolean;
  blockedReason: BranchBlockedReason | null;
}

/** Valores con los que el form de "Nueva sucursal" nace prellenado. */
export interface BranchDefaults {
  category: string;
  city: string;
  state: string;
}

/** Lo que el layout le baja al sidebar para pintar el switcher. */
export interface SidebarBranchInfo {
  quota: BranchQuota;
  defaults: BranchDefaults;
}
