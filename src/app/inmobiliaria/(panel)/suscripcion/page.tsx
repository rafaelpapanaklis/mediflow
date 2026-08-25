export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import type { Dictionary } from "@/i18n/t";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import {
  getRealtyBillingAccount,
  getRealtyBillingSummary,
  getRealtyUsage,
  toRealtyCents,
} from "@/lib/realty/billing";
import { getRealtyPlans } from "@/lib/realty/plans";
import { REALTY_FEATURES, isRealtyPlanId } from "@/lib/realty/plan-shared";
import { realtyUsageStates, type RealtyLimitKey } from "@/lib/realty/gating";
import { RealtyBillingScreen } from "@/components/realty/billing/billing-screen";
import type {
  RealtyBillingScreenData,
  RealtyLimitDTO,
  RealtyPlanCardDTO,
} from "@/components/realty/billing/shared";

/**
 * /inmobiliaria/suscripcion — la suscripción a DaleControl de esta cuenta.
 *
 * 🔴 ESTA PÁGINA NO PUEDE EXIGIR SUSCRIPCIÓN ACTIVA. Es justo a donde manda
 * el router (/inmobiliaria/page.tsx) cuando la cuenta está impaga: cortar
 * aquí sería un bucle infinito de redirects.
 *
 * Todo precio y todo límite salen de `realty_plan_configs` vía getRealtyPlans
 * (con caché y fallback al seed). La pantalla es tonta: recibe números ya
 * resueltos y los pinta.
 *
 * Diccionario: se baja el sub-árbol YA RECORTADO (`realty.billing`) y el
 * componente NO antepone prefijo. Ver la cabecera de billing-screen.tsx.
 */
const LIMIT_ORDER: RealtyLimitKey[] = [
  "users",
  "offices",
  "properties",
  "storage",
  "messages",
];

export default async function RealtySubscriptionPage({
  searchParams,
}: {
  searchParams?: { checkout?: string; session_id?: string };
}) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const canManage = hasRealtyPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "billing.manage",
  );

  const account = await getRealtyBillingAccount(ctx);
  const [summary, usage, plans] = await Promise.all([
    // Sin permiso de dinero no se va a Stripe: ni facturas ni tarjeta.
    canManage
      ? getRealtyBillingSummary(account)
      : Promise.resolve(null),
    getRealtyUsage(ctx.accountId, ctx.account),
    getRealtyPlans(),
  ]);

  const planId = isRealtyPlanId(account.plan) ? account.plan : "PROPIETARIO";
  const resolved = plans.find((p) => p.id === planId) ?? plans[0];
  const states = realtyUsageStates(resolved, usage, ctx.account);

  const limits: RealtyLimitDTO[] = LIMIT_ORDER.map((key) => {
    const s = states[key];
    // `remaining` se queda fuera a propósito: es Infinity cuando el cupo es
    // ilimitado y eso NO sobrevive la serialización a cliente.
    return {
      key: s.key,
      used: s.used,
      limit: s.limit,
      unlimited: s.unlimited,
      percent: s.percent,
      nearLimit: s.nearLimit,
      atLimit: s.atLimit,
    };
  });

  const planCards: RealtyPlanCardDTO[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    priceMonthlyCents: toRealtyCents(p.priceMonthly),
    priceYearlyCents: p.priceYearly === null ? null : toRealtyCents(p.priceYearly),
    maxUsers: p.maxUsers,
    maxOffices: p.maxOffices,
    maxProperties: p.maxProperties,
    storageQuotaMb: p.storageQuotaMb,
    messageQuota: p.messageQuota,
    // El orden del catálogo, no el del Json de la fila.
    features: REALTY_FEATURES.map((f) => f.key).filter((k) => p.features[k] === true),
    isActive: p.isActive,
  }));

  const data: RealtyBillingScreenData = {
    planId,
    planName: resolved.name,
    subscriptionStatus: account.subscriptionStatus,
    subscriptionActive: summary?.subscriptionActive ?? false,
    stripeConfigured: summary?.stripeConfigured ?? false,
    stripeUnreachable: summary?.stripeUnreachable ?? false,
    hasCustomer: summary?.hasCustomer ?? false,
    canManage,
    subscription: summary?.subscription ?? null,
    invoices: summary?.invoices ?? [],
    plans: planCards,
    limits,
  };

  const dict = (getRealtyDict(ctx.account.locale).realty as Dictionary)
    .billing as Dictionary;

  const raw = searchParams?.checkout;
  const checkout = {
    result: raw === "success" ? ("success" as const) : raw === "cancel" ? ("cancel" as const) : null,
    sessionId: searchParams?.session_id ?? null,
  };

  return (
    <RealtyBillingScreen
      dict={dict}
      locale={ctx.account.locale}
      data={data}
      checkout={checkout}
    />
  );
}
