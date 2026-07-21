import "server-only";
import { prisma } from "@/lib/prisma";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/plan-status";
import { getPlanLimits } from "@/lib/plans";
import { logAudit } from "@/lib/audit";
import { logError } from "@/lib/safe-log";

/**
 * MULTI-CLÍNICA — BILLING de SUCURSALES CUBIERTAS.
 *
 * Una "sucursal cubierta" nace en POST /api/clinics: va INCLUIDA en la
 * suscripción de la clínica MADRE (la pagadora), así que nace con acceso
 * completo pero SIN cobro propio (subscriptionStatus "active", monthlyPrice 0,
 * sin stripeSubscriptionId, sin nextBillingDate, trialEndsAt ya vencido). El
 * hueco que cierra este módulo (follow-up conocido de Fase 1): si la
 * suscripción de la madre se cancela / cae en impago / baja de plan, esas sedes
 * se quedaban "active" para siempre → acceso gratis indefinido.
 *
 * ─── CÓMO SE DETECTA una sucursal cubierta ────────────────────────────────
 * Criterio que FALLA SEGURO — la prioridad #1 es NO suspender jamás a quien
 * paga. Una clínica es "cubierta" cuando NO tiene NINGUNA señal de pago de
 * plataforma propio:
 *     cubierta  ⇔  !stripeSubscriptionId        (sin suscripción Stripe propia)
 *              ∧  !nextBillingDate              (sin ciclo de cobro propio)
 *              ∧  (monthlyPrice ?? 0) === 0     (sin precio propio)
 *
 * Por qué `nextBillingDate` y NO `stripeCustomerId`:
 *   • Toda auto-pagadora (tarjeta, SPEI/OXXO o activación admin) tiene un CICLO
 *     de cobro: `nextBillingDate` se setea al activar (activatePlatformSubscription,
 *     customer.subscription.* con current_period_end, o /admin billing). Una
 *     sucursal cubierta NUNCA lo tiene. Esto protege a los pagadores SPEI/OXXO
 *     —que no tienen suscripción Stripe recurrente— de un falso positivo.
 *   • Una recarga del monedero de IA es PREPAGO, NO una suscripción: setea
 *     `stripeCustomerId` pero NO `nextBillingDate`. Por eso NO usamos
 *     stripeCustomerId como señal: una sucursal cubierta que recargó IA SIGUE
 *     siendo cubierta (y se suspende con la madre). Su SALDO de IA queda intacto
 *     porque aquí SOLO tocamos `subscriptionStatus`, jamás el monedero.
 *
 * ─── MECANISMO suspender / restaurar (sin tocar schema, sin SQL) ───────────
 *   • SUSPENDER = subscriptionStatus := "branch_suspended" (fuera del set
 *     activo → el gating existente de plan-status.ts / dashboard/layout la manda
 *     a /dashboard/suspended). Solo se suspende una sede que HOY está activa.
 *   • RESTAURAR = subscriptionStatus := "active". Solo se restaura una sede que
 *     esté EXACTAMENTE en "branch_suspended" (marca puesta por nosotros), así
 *     jamás damos acceso a una clínica suspendida/cancelada por otra vía ni a
 *     una que nunca pagó.
 *   • IDEMPOTENTE ante reintentos de webhook: correr 2 veces = mismo estado.
 *   • REVERSIBLE y NO destructivo: una sucursal cubierta sana siempre está
 *     "active", así que branch_suspended → active la devuelve exactamente a como
 *     estaba. Nunca se borran clínicas ni datos ni saldos.
 */

/** Estado sentinela de una sucursal cubierta suspendida por lapso/downgrade de
 *  la madre. Fuera de ACTIVE_SUBSCRIPTION_STATUSES a propósito → gateada. */
export const BRANCH_SUSPENDED_STATUS = "branch_suspended";

export type CoveredBranchBilling = {
  stripeSubscriptionId?: string | null;
  nextBillingDate?: Date | string | null;
  monthlyPrice?: number | null;
};

/**
 * True si la clínica no tiene NINGUNA señal de pago de plataforma propio y por
 * tanto es una sucursal cubierta por la suscripción de otra (la madre).
 * Ver la doc del módulo para el porqué de cada señal.
 */
export function isCoveredBranch(clinic: CoveredBranchBilling): boolean {
  const hasOwnSubscription = !!clinic.stripeSubscriptionId;
  const hasOwnBillingCycle = !!clinic.nextBillingDate;
  const hasOwnPrice = (clinic.monthlyPrice ?? 0) > 0;
  return !hasOwnSubscription && !hasOwnBillingCycle && !hasOwnPrice;
}

type CoveredBranchRow = {
  id: string;
  name: string;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  nextBillingDate: Date | null;
  monthlyPrice: number | null;
  createdAt: Date;
};

/** Dedupe sin iterar Sets (tsconfig sin downlevelIteration; ver lección). */
function uniqStrings(arr: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (out.indexOf(arr[i]) === -1) out.push(arr[i]);
  }
  return out;
}

/**
 * Sucursales CUBIERTAS del MISMO dueño que la pagadora, EXCLUYENDO la pagadora,
 * ordenadas de más antigua a más nueva (createdAt asc). Excluye archivadas.
 *
 * "Dueño" = supabaseId con rol SUPER_ADMIN activo (misma definición que
 * @/lib/branches). Anti-IDOR: los ids salen SIEMPRE de la BD a partir del
 * clinicId de la pagadora, nunca de un body. Si la pagadora tiene varios
 * SUPER_ADMIN (socios), se toma la unión de las clínicas de todos ellos; el
 * filtro isCoveredBranch garantiza que ninguna clínica con cobro propio entre
 * al conjunto (así una clínica de un socio que paga aparte NUNCA se toca).
 */
export async function findCoveredBranchesOfOwner(payerClinicId: string): Promise<CoveredBranchRow[]> {
  const owners = await prisma.user.findMany({
    where: { clinicId: payerClinicId, role: "SUPER_ADMIN", isActive: true },
    select: { supabaseId: true },
  });
  const supabaseIds = uniqStrings(owners.map((o) => o.supabaseId));
  if (supabaseIds.length === 0) return [];

  const ownerRows = await prisma.user.findMany({
    where: { supabaseId: { in: supabaseIds }, role: "SUPER_ADMIN", isActive: true },
    select: { clinicId: true },
  });
  const otherClinicIds = uniqStrings(ownerRows.map((r) => r.clinicId)).filter(
    (id) => id !== payerClinicId,
  );
  if (otherClinicIds.length === 0) return [];

  const clinics = await prisma.clinic.findMany({
    where: { id: { in: otherClinicIds }, archivedAt: null },
    select: {
      id: true,
      name: true,
      subscriptionStatus: true,
      stripeSubscriptionId: true,
      nextBillingDate: true,
      monthlyPrice: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return clinics.filter((c) => isCoveredBranch(c));
}

export interface SyncCoveredBranchesResult {
  suspended: number;
  restored: number;
  skipped: number;
  reason: "ok" | "payer_not_found" | "payer_no_billing_footprint" | "no_covered_branches";
}

/**
 * Propaga el estado de la MADRE a sus sucursales cubiertas.
 *   nextStatus = estado recién aplicado a la madre (p.ej. sub.status del webhook,
 *                "cancelled", "past_due", "active"…).
 *   • Si nextStatus está en el set activo Y la sede cabe en el cupo → RESTAURA.
 *   • Si no está activo, o el downgrade la dejó fuera de cupo → SUSPENDE.
 *
 * El cupo sale del plan ACTUAL de la madre: allowed = maxClinics - 1 (la madre
 * ocupa 1 lugar). Así este mismo helper cubre el DOWNGRADE sin lógica aparte:
 * CLINIC→PRO (maxClinics 1) ⇒ allowed 0 ⇒ suspende todas las cubiertas;
 * conserva las más ANTIGUAS si el cupo fuese parcial. La pagadora nunca es
 * "cubierta", así que jamás se toca a sí misma.
 *
 * ANTI FALSO-POSITIVO: si la supuesta pagadora no tiene señal de cobro alguna
 * (es indistinguible de una cubierta), NO se toca nada y se loguea.
 * IDEMPOTENTE: solo escribe cuando el estado cambia de verdad.
 */
export async function syncCoveredBranches(
  payerClinicId: string,
  nextStatus: string | null,
): Promise<SyncCoveredBranchesResult> {
  const payer = await prisma.clinic.findUnique({
    where: { id: payerClinicId },
    select: {
      id: true,
      plan: true,
      stripeSubscriptionId: true,
      nextBillingDate: true,
      monthlyPrice: true,
    },
  });
  if (!payer) return { suspended: 0, restored: 0, skipped: 0, reason: "payer_not_found" };

  // La pagadora, por definición, NO es una sucursal cubierta (tiene alguna señal
  // de cobro propio). Si no la tiene, no podemos afirmar que sea la pagadora →
  // abstente de tocar nada (evita suspender por error a quien sí paga).
  if (isCoveredBranch(payer)) {
    logError(
      "[branches-billing] pagadora sin señal de cobro propia; no se sincroniza (evita falso positivo)",
      { payerClinicId, nextStatus },
    );
    return { suspended: 0, restored: 0, skipped: 0, reason: "payer_no_billing_footprint" };
  }

  const branches = await findCoveredBranchesOfOwner(payerClinicId);
  if (branches.length === 0) {
    return { suspended: 0, restored: 0, skipped: 0, reason: "no_covered_branches" };
  }

  const payerHealthy = nextStatus !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(nextStatus);
  const { maxClinics } = await getPlanLimits(payer.plan);
  const allowedBranches =
    maxClinics === null ? Number.POSITIVE_INFINITY : Math.max(0, maxClinics - 1);

  let suspended = 0;
  let restored = 0;
  let skipped = 0;

  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    const status = b.subscriptionStatus ?? "";
    const currentlyActive = ACTIVE_SUBSCRIPTION_STATUSES.has(status);
    const currentlySuspendedByUs = status === BRANCH_SUSPENDED_STATUS;
    // Conserva activas las más antiguas dentro del cupo; el resto, fuera.
    const shouldBeActive = payerHealthy && i < allowedBranches;

    if (!shouldBeActive && currentlyActive) {
      await applyBranchStatus(b, BRANCH_SUSPENDED_STATUS, payerClinicId, nextStatus, "suspend");
      suspended++;
    } else if (shouldBeActive && currentlySuspendedByUs) {
      await applyBranchStatus(b, "active", payerClinicId, nextStatus, "restore");
      restored++;
    } else {
      // No-op idempotente: ya está en el estado correcto, o está en un estado
      // que NO nos toca tocar (pending_payment, cancelled por otra vía, etc.).
      skipped++;
    }
  }

  return { suspended, restored, skipped, reason: "ok" };
}

/**
 * Aplica el cambio de estado a UNA sucursal cubierta + auditoría del porqué.
 * SOLO toca `subscriptionStatus`: el saldo del monedero de IA y cualquier otro
 * dato quedan intactos (la suspensión es reversible y no destructiva).
 */
async function applyBranchStatus(
  branch: CoveredBranchRow,
  targetStatus: string,
  payerClinicId: string,
  payerStatus: string | null,
  intent: "suspend" | "restore",
): Promise<void> {
  const before = branch.subscriptionStatus ?? null;
  if (before === targetStatus) return; // idempotente: nada que cambiar

  await prisma.clinic.update({
    where: { id: branch.id },
    data: { subscriptionStatus: targetStatus },
  });

  // Auditoría de POR QUÉ cambió (suspendió/restauró). En contexto webhook no hay
  // User actor: se usa clinicId como placeholder, igual que el resto del webhook
  // de Stripe (que ya audita cambios de suscripción con logAudit).
  await logAudit({
    clinicId: branch.id,
    userId: branch.id,
    entityType: "subscription",
    entityId: branch.id,
    action: "update",
    changes: {
      subscriptionStatus: { before, after: targetStatus },
      _source: {
        before: null,
        after: { event: "covered-branch-sync", intent, payerClinicId, payerStatus },
      },
    },
  });
}
