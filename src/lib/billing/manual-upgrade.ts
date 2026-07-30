import "server-only";
import { prisma } from "@/lib/prisma";
import {
  MANUAL_PERIOD_DAYS,
  MIN_CHARGEABLE_CENTS,
  changeDirection,
  daysRemainingUntil,
  manualUpgradeDiffCents,
  planAmountCents,
  type BillingInterval,
} from "@/lib/billing/proration";

/**
 * Cotización del diferencial de un upgrade para clínicas SIN suscripción de
 * tarjeta en Stripe (pagaron SPEI/OXXO: pago único, `stripeSubscriptionId` es
 * null y `subscriptionStatus` quedó en "active").
 *
 * Sin suscripción no hay prorrateo de Stripe: lo calculamos nosotros sobre los
 * días que le quedan del periodo pagado (`trialEndsAt` = "pagado-hasta").
 */
export interface ManualUpgradeQuote {
  interval: BillingInterval;
  periodDays: number;
  daysRemaining: number;
  currentCents: number;
  targetCents: number;
  direction: "upgrade" | "downgrade" | "same";
  /** Diferencial a cobrar en centavos MXN (0 si no hay nada que cobrar). */
  diffCents: number;
  /** true si el diferencial supera el mínimo que Stripe acepta cobrar. */
  chargeable: boolean;
  /** Fin del periodo pagado (no se mueve al mejorar el plan). */
  periodEnd: Date | null;
}

type PlanPrices = { priceMxn: number; priceMxnAnnual: number };

/**
 * Ciclo (mensual/anual) que compró una clínica que paga por SPEI/OXXO.
 *
 * `Clinic` no guarda el ciclo, pero `/api/billing/checkout` deja el `billing`
 * elegido en la bitácora (`entityType: "subscription"`, `action: "create"`,
 * `changes._created.after.billing`). Leemos el más reciente; ante cualquier duda
 * caemos a "month", que es el ciclo por defecto del checkout y el que menos
 * cobra por día (nunca sobre-cobramos por un dato que no pudimos confirmar).
 */
export async function inferManualInterval(clinicId: string): Promise<BillingInterval> {
  try {
    const row = await prisma.auditLog.findFirst({
      where: { clinicId, entityType: "subscription", action: "create" },
      orderBy: { createdAt: "desc" },
      select: { changes: true },
    });
    const billing = (row?.changes as any)?._created?.after?.billing;
    return billing === "annual" ? "year" : "month";
  } catch {
    return "month";
  }
}

export async function buildManualUpgradeQuote(args: {
  clinicId: string;
  /** "Pagado-hasta" de la clínica (Clinic.trialEndsAt). NO es un trial gratis. */
  paidUntil: Date | string | null | undefined;
  currentPlan: PlanPrices;
  targetPlan: PlanPrices;
  now?: Date;
}): Promise<ManualUpgradeQuote> {
  const now = args.now ?? new Date();
  const interval = await inferManualInterval(args.clinicId);
  const periodDays = MANUAL_PERIOD_DAYS[interval];
  const daysRemaining = daysRemainingUntil(args.paidUntil, now);
  const currentCents = planAmountCents(args.currentPlan, interval);
  const targetCents = planAmountCents(args.targetPlan, interval);
  const direction = changeDirection(currentCents, targetCents);

  const diffCents =
    direction === "upgrade"
      ? manualUpgradeDiffCents({ currentCents, targetCents, daysRemaining, periodDays })
      : 0;

  return {
    interval,
    periodDays,
    daysRemaining,
    currentCents,
    targetCents,
    direction,
    diffCents,
    chargeable: diffCents >= MIN_CHARGEABLE_CENTS,
    periodEnd: args.paidUntil ? new Date(args.paidUntil) : null,
  };
}
