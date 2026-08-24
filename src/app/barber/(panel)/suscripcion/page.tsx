export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlans } from "@/lib/barber/plans";
import { BARBER_FEATURES } from "@/lib/barber/plan-shared";
import { getBarberGate } from "@/lib/barber/gating";
import {
  getBarberBillingShop,
  getBarberBillingSummary,
  getBarberStripe,
  isBarberStripeConfigured,
  toCents,
} from "@/lib/barber/billing";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { BillingScreen } from "@/components/barber/billing/billing-screen";
import {
  toBarberGateDTO,
  type BarberBillingSummary,
  type BarberPlanCardDTO,
} from "@/components/barber/billing/shared";
import "@/components/barber/billing/billing.css";

interface PageProps {
  searchParams?: { checkout?: string; session_id?: string };
}

/**
 * /barber/suscripcion — plan y cobro de DaleControl Barber. Aquí aterriza el
 * router (/barber) cuando la barbería está impaga. TODOS los precios salen de
 * barber_plan_configs (getBarberPlans → centavos con Decimal); el estado que
 * abre o cierra el panel es el de la BD (gate) y Stripe aporta fechas,
 * tarjeta, facturas y cobros rechazados. Cualquier rol puede VER su estado;
 * contratar/cambiar/cancelar exige billing.manage (también en las APIs).
 */
export default async function BarberSuscripcionPage({ searchParams }: PageProps) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const locale = ctx.barbershop.locale;
  const canManage = hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "billing.manage",
  );

  const [plans, gate, shop] = await Promise.all([
    getBarberPlans(),
    getBarberGate(ctx),
    getBarberBillingShop(ctx),
  ]);

  const summary: BarberBillingSummary = canManage
    ? await getBarberBillingSummary(getBarberStripe(), shop, plans)
    : { configured: isBarberStripeConfigured(), stripeError: null, subscription: null, invoices: [], failedAttempts: [] };

  const cards: BarberPlanCardDTO[] = plans
    .filter((p) => p.isActive || p.id === gate.planId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      priceMonthlyCents: toCents(p.priceMonthly),
      priceYearlyCents: p.priceYearly === null || p.priceYearly === undefined ? null : toCents(p.priceYearly),
      firstMonthCents: p.firstMonthPrice === null || p.firstMonthPrice === undefined ? null : toCents(p.firstMonthPrice),
      maxBarbers: p.maxBarbers,
      maxBranches: p.maxBranches,
      messageQuota: p.messageQuota,
      features: BARBER_FEATURES.map((f) => f.key).filter((key) => p.features[key] === true),
      isActive: p.isActive,
    }));

  const checkoutParam = searchParams?.checkout;
  const checkout = {
    result: checkoutParam === "success" ? ("success" as const) : checkoutParam === "cancel" ? ("cancel" as const) : null,
    sessionId: typeof searchParams?.session_id === "string" ? searchParams.session_id : null,
  };

  return (
    <BillingScreen
      locale={locale}
      dict={getBarberDict(locale)}
      canManage={canManage}
      plans={cards}
      gate={toBarberGateDTO(gate)}
      summary={summary}
      checkout={checkout}
    />
  );
}
