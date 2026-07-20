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

/* ──────────────────────────────────────────────────────────────────────────
 * MULTI-CLÍNICA · FASE 2 — compartir PACIENTES entre sedes vinculadas.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * ⛳ FLAG MAESTRO de la Fase 2. En `false`, `getVisiblePatientClinicIds`
 * devuelve SIEMPRE `[clinicId]` y toda la UI del tema queda oculta → el
 * comportamiento es idéntico al de hoy (cada sede 100% aislada), así que
 * mergear a main NO cambia nada en producción.
 *
 * Se enciende a mano (aquí, y se redeploya) DESPUÉS del QA en preview.
 * Mismo patrón que HIDE_SPECIALTIES en sidebar.tsx: constante compilada, no
 * env var, para que el bundle del cliente y el server no puedan divergir.
 *
 * Vive en branches-SHARED (sin "server-only") a propósito: lo leen tanto el
 * server (helper de visibilidad, endpoints) como los componentes cliente
 * (diálogo de sucursal, pantalla de configuración, badge de sede).
 */
export const PATIENT_SHARING_ENABLED = false;

/** Un vínculo de pacientes entre dos sedes, tal como lo expone la API. */
export interface ClinicPatientLinkRow {
  id: string;
  clinicAId: string;
  clinicBId: string;
}

/** Sede del dueño, para pintar la matriz de vínculos. */
export interface OwnedBranchRow {
  clinicId: string;
  clinicName: string;
}

/**
 * Normaliza un par de sedes a (menor, mayor) por id. El vínculo es SIMÉTRICO:
 * guardarlo siempre en el mismo orden es lo que hace que el @@unique de
 * ClinicPatientLink impida el duplicado invertido (A,B) / (B,A).
 *
 * Puro y client-safe: el cliente lo usa para saber si un par ya está marcado
 * sin tener que probar las dos combinaciones.
 */
export function normalizeClinicPair(x: string, y: string): { clinicAId: string; clinicBId: string } {
  return x < y ? { clinicAId: x, clinicBId: y } : { clinicAId: y, clinicBId: x };
}

/** Clave estable de un par, para Sets/keys de React. */
export function clinicPairKey(x: string, y: string): string {
  const { clinicAId, clinicBId } = normalizeClinicPair(x, y);
  return `${clinicAId}::${clinicBId}`;
}

/** Lo que el layout le baja al sidebar para pintar el switcher. */
export interface SidebarBranchInfo {
  quota: BranchQuota;
  defaults: BranchDefaults;
}
