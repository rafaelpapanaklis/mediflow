// Fuente única de verdad del estado de plan de una clínica.
//
// Regla de negocio (extraída del layout de /dashboard, SIN cambio de
// semántica): una clínica está SIN acceso cuando su trial ya venció
// (trialEndsAt < now) Y su suscripción no está activa (subscriptionStatus
// no es active / trialing / paid). Una clínica que paga limpia
// subscriptionStatus a 'active' y NO se bloquea aunque trialEndsAt siga en
// el pasado. Cubre tanto la cuenta nueva (pending_payment, trial en cero)
// como la suspendida por impago. Aplica a TODOS los roles.

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid"]);

type PlanClinic =
  | { trialEndsAt?: Date | string | null; subscriptionStatus?: string | null }
  | null
  | undefined;

export function isPlanExpired(clinic: PlanClinic): boolean {
  if (!clinic) return false;
  const trialEndsAt = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  const now = new Date();
  const subscriptionStatus = clinic.subscriptionStatus ?? null;
  const subscriptionActive =
    subscriptionStatus !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
  const trialExpired = !!trialEndsAt && trialEndsAt < now;
  return trialExpired && !subscriptionActive;
}

// Rutas /api EXENTAS del gate de plan vencido, para que una clínica
// suspendida pueda PAGAR y recuperar acceso (y cerrar / refrescar sesión):
//   • /api/billing/* → checkout, change-plan, portal, invoices
//   • /api/auth/*    → login/logout/callback/2fa/register
// Todo lo demás bajo /api queda bloqueado.
const PLAN_GATE_ALLOWLIST_BASES = ["/api/billing", "/api/auth"];

export function isPlanGateAllowlistedPath(pathname: string): boolean {
  return PLAN_GATE_ALLOWLIST_BASES.some(
    (base) => pathname === base || pathname.startsWith(base + "/"),
  );
}

// True si el pathname es una ruta /api NO exenta y por tanto debe bloquearse
// cuando el plan está vencido. Sólo aplica a /api: para páginas server
// (pathname /dashboard/*) o callers sin x-pathname devuelve false — esas
// navegaciones ya las redirige el layout de /dashboard a /dashboard/suspended.
export function isApiPathBlockedForExpiredPlan(pathname: string | null | undefined): boolean {
  if (!pathname || !pathname.startsWith("/api")) return false;
  return !isPlanGateAllowlistedPath(pathname);
}
