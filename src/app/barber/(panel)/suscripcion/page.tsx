export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlans } from "@/lib/barber/plans";
import { BARBER_FEATURES, isBarberPlanId } from "@/lib/barber/plan-shared";
import { getBarberGate } from "@/lib/barber/gating";
import {
  getBarberBillingShop,
  getBarberBillingSummary,
  getBarberStripe,
  isBarberStripeConfigured,
  toCents,
} from "@/lib/barber/billing";
import {
  BARBER_SUPPORT_PATH,
  barberSupportWhatsappUrl,
  dalecontrolWhatsappDisplay,
} from "@/lib/barber/marketing";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import { hasBarberPaidAccess } from "@/lib/barber/paid-access";
import { BarberDenied } from "@/components/barber/cash/denied";
import { BillingScreen } from "@/components/barber/billing/billing-screen";
import {
  toBarberGateDTO,
  type BarberBillingSummary,
  type BarberPlanCardDTO,
} from "@/components/barber/billing/shared";
import "@/components/barber/billing/billing.css";

interface PageProps {
  searchParams?: Promise<{ checkout?: string; session_id?: string; plan?: string | string[] }>;
}

/**
 * /barber/suscripcion — plan y cobro de DaleControl Barber. Aquí aterriza el
 * router (/barber) cuando la barbería está impaga. TODOS los precios salen de
 * barber_plan_configs (getBarberPlans → centavos con Decimal); el estado que
 * abre o cierra el panel es el de la BD (gate) y Stripe aporta fechas,
 * tarjeta, facturas y cobros rechazados. Cualquier rol puede VER su estado;
 * contratar/cambiar/cancelar exige billing.manage (también en las APIs).
 */
export default async function BarberSuscripcionPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");

  const locale = ctx.barbershop.locale;
  const canManage = hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "billing.manage",
  );

  // Sin billing.manage (Barbero, Recepción, Encargado) la sección no se abre
  // escribiendo la dirección: «Sin acceso», como las demás. La pantalla y
  // sus APIs ya lo exigían; ahora también la página.
  // EXCEPCIÓN a propósito: con la barbería impaga, el candado de pago manda
  // aquí a TODOS los roles (es la única página que queda abierta). Ahí se
  // sigue enseñando el estado en solo lectura, para que entiendan por qué
  // está todo cerrado; contratar sigue siendo solo del dueño.
  if (!canManage && (await hasBarberPaidAccess(ctx))) {
    const t = getBarberT(resolveBarberLocale(locale));
    return (
      <BarberDenied
        kind="permission"
        title={t("barber.suscripcion.noPermissionTitle")}
        body={t("barber.suscripcion.noPermissionBody")}
      />
    );
  }

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
      // El plan que se eligió en la portada (?plan=). Solo ids de la casa:
      // lo que no lo sea se ignora y la pantalla sale como siempre.
      chosenPlanId={isBarberPlanId(searchParams?.plan) ? searchParams.plan : null}
      // A quién escribirle cuando el cobro falla: ticket + WhatsApp oficial.
      support={{
        path: BARBER_SUPPORT_PATH,
        whatsappUrl: barberSupportWhatsappUrl(ctx.barbershop.name),
        whatsappNumber: dalecontrolWhatsappDisplay(),
      }}
    />
  );
}
