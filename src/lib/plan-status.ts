// Fuente única de verdad del estado de plan de una clínica.
//
// Regla de negocio (extraída del layout de /dashboard, SIN cambio de
// semántica): una clínica está SIN acceso cuando su periodo ya venció
// (trialEndsAt < now) Y su suscripción no está activa (subscriptionStatus
// no es active / trialing / paid). Una clínica que paga limpia
// subscriptionStatus a 'active' y NO se bloquea aunque trialEndsAt siga en
// el pasado. Cubre tanto la cuenta nueva (pending_payment, trial en cero)
// como la suspendida por impago. Aplica a TODOS los roles.
//
// ── Qué significa `trialEndsAt` ─────────────────────────────────────────────
// El campo se llama "trial" por herencia, pero desde que la cuenta nace SIN
// trial (register: trialEndsAt = ahora) significa "HASTA CUÁNDO tiene acceso
// la clínica sin mirar la suscripción": el fin del periodo pagado
// (activatePlatformSubscription y customer.subscription.* lo escriben junto
// con nextBillingDate), la cortesía que da /admin con "+N días" o el trial
// legado de 14 días. Por eso:
//   • VENCIDA  = periodo terminado Y sin suscripción viva   → isPlanExpired
//   • EN TRIAL = periodo por delante Y sin suscripción viva → isInTrial
//     (una clínica que PAGA nunca está "en trial", aunque su periodo pagado
//     esté en el futuro: trialEndsAt = nextBillingDate para ella).
// Cualquier pantalla, cron o gate que compare trialEndsAt contra hoy por su
// cuenta es una copia a ojo de estas reglas; la prueba
// src/lib/__tests__/plan-status-guard.test.ts la caza.

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "paid"]);

/** Statuses que significan "Stripe intentó cobrar y no pudo" (la suscripción sigue viva en Stripe). */
export const PAYMENT_FAILED_STATUSES = new Set(["past_due", "unpaid"]);

type PlanClinic =
  | {
      trialEndsAt?: Date | string | null;
      subscriptionStatus?: string | null;
      nextBillingDate?: Date | string | null;
    }
  | null
  | undefined;

export function isSubscriptionActive(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && ACTIVE_SUBSCRIPTION_STATUSES.has(status);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 86_400_000;

/**
 * Días enteros (redondeo hacia arriba) desde `now` hasta `date`. Negativo si
 * ya pasó, null sin fecha. Es el ÚNICO cálculo de "días restantes" del plan:
 * las pantallas lo usan para el texto y NUNCA para decidir vencimiento.
 */
export function daysUntil(date: Date | string | null | undefined, now: Date = new Date()): number | null {
  const d = toDate(date);
  if (!d) return null;
  // `|| 0` normaliza el -0 de Math.ceil(-0.5) para que "vence hoy" sea 0.
  return Math.ceil((d.getTime() - now.getTime()) / DAY_MS) || 0;
}

export function isPlanExpired(clinic: PlanClinic, now: Date = new Date()): boolean {
  if (!clinic) return false;
  const trialEndsAt = toDate(clinic.trialEndsAt);
  const trialExpired = !!trialEndsAt && trialEndsAt < now;
  return trialExpired && !isSubscriptionActive(clinic.subscriptionStatus);
}

/**
 * Trial / cortesía VIGENTE: periodo por delante y SIN suscripción viva.
 * Misma regla que usaba el layout de /dashboard para el banner y el sidebar.
 * Una clínica con suscripción activa devuelve false aunque su periodo pagado
 * esté en el futuro (para ella trialEndsAt es el fin del periodo, no un trial).
 */
export function isInTrial(clinic: PlanClinic, now: Date = new Date()): boolean {
  if (!clinic) return false;
  const trialEndsAt = toDate(clinic.trialEndsAt);
  return !!trialEndsAt && trialEndsAt > now && !isSubscriptionActive(clinic.subscriptionStatus);
}

/**
 * Los cuatro estados que /admin distingue de un vistazo. Derivados de
 * isPlanExpired + subscriptionStatus, nunca de una comparación propia:
 *   • active   → AL CORRIENTE: suscripción viva (active / trialing / paid).
 *   • past_due → COBRO FALLIDO: Stripe no pudo cobrar (past_due / unpaid) pero
 *                el periodo con acceso todavía no termina; Stripe reintenta.
 *   • trial    → trial o cortesía vigente (sin suscripción viva, periodo por
 *                delante). Incluye la cancelada a la que aún le queda periodo.
 *   • expired  → VENCIDA de verdad: exactamente isPlanExpired === true. Es la
 *                única que el gate bloquea.
 * Invariante (probado): kind === "expired" ⇔ isPlanExpired(clinic, now).
 */
export type PlanStatusKind = "active" | "past_due" | "trial" | "expired";

export interface PlanStatus {
  kind: PlanStatusKind;
  /** Lo que dice el gate real: true = la clínica NO entra al panel. */
  expired: boolean;
  /** Fin del periodo con acceso (trialEndsAt). */
  periodEnd: Date | null;
  /** Días hasta periodEnd (negativo si ya pasó). */
  daysLeft: number | null;
  /** Próximo cobro según Stripe / activación manual (informativo). */
  nextBillingDate: Date | null;
  /** subscriptionStatus crudo, para explicar el POR QUÉ de expired/past_due. */
  subscriptionStatus: string | null;
}

export function getPlanStatus(clinic: PlanClinic, now: Date = new Date()): PlanStatus {
  const subscriptionStatus = clinic?.subscriptionStatus ?? null;
  const periodEnd = toDate(clinic?.trialEndsAt);
  const nextBillingDate = toDate(clinic?.nextBillingDate);
  const expired = isPlanExpired(clinic, now);
  const daysLeft = daysUntil(periodEnd, now);

  let kind: PlanStatusKind;
  if (expired) kind = "expired";
  else if (isSubscriptionActive(subscriptionStatus)) kind = "active";
  else if (subscriptionStatus !== null && PAYMENT_FAILED_STATUSES.has(subscriptionStatus)) kind = "past_due";
  else kind = "trial";

  return { kind, expired, periodEnd, daysLeft, nextBillingDate, subscriptionStatus };
}

// Rutas /api EXENTAS del gate de plan vencido, para que una clínica
// suspendida pueda PAGAR, PEDIR AYUDA y recuperar acceso (y cerrar / refrescar
// sesión):
//   • /api/billing/*     → checkout, change-plan, portal, invoices
//   • /api/auth/*        → login/logout/callback/2fa/register
//   • /api/support/*     → levantar/responder tickets de soporte. Las pantallas
//                          /dashboard/soporte son client components que piden
//                          estos endpoints por fetch; sin exentarlos, una
//                          clínica suspendida ve soporte pero no puede leer ni
//                          enviar nada (401). El clinicId sale SIEMPRE de la
//                          sesión (getAuthContext), así que exentar el
//                          plan-gate NO afecta el aislamiento multi-tenant.
//   • /api/switch-clinic → cambiar de clínica activa. Un dueño con varias sedes
//                          y UNA suspendida debe poder salir a una activa desde
//                          el switcher del menú reducido; solo alterna entre
//                          clínicas donde la sesión ya es miembro.
// Todo lo demás bajo /api queda bloqueado.
const PLAN_GATE_ALLOWLIST_BASES = [
  "/api/billing",
  "/api/auth",
  "/api/support",
  "/api/switch-clinic",
];

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

// ── Páginas de /dashboard que una clínica suspendida SÍ puede visitar ──
// Cuando el plan venció, el layout de /dashboard rebota TODA navegación a
// /dashboard/suspended. Estas son las únicas páginas exentas de ese rebote:
//   • /dashboard/suspended(/...) → la propia pantalla de pago / activación Y
//                                  /dashboard/suspended/success, a donde vuelve
//                                  Stripe tras el checkout. Esa pantalla vive
//                                  en el hueco entre el pago y el webhook: la
//                                  clínica sigue "vencida" en la BD, así que
//                                  con igualdad exacta el layout la rebotaba a
//                                  "elige tu plan" y el usuario pagaba dos veces.
//   • /dashboard/soporte(/...)   → abrir y responder tickets de soporte, para
//                                  pedir ayuda mientras reactiva su plan (incluye
//                                  el detalle /dashboard/soporte/[id]).
// FUENTE ÚNICA: la usan a la vez el redirect server-side (layout) y el guard
// de cliente (ExpiredPlanModal). Centralizarla evita que ambas superficies se
// desincronicen y una permita navegar a donde la otra rebota.
export function isAllowedWhileSuspended(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === "/dashboard/suspended" ||
    pathname.startsWith("/dashboard/suspended/") ||
    pathname === "/dashboard/soporte" ||
    pathname.startsWith("/dashboard/soporte/")
  );
}
