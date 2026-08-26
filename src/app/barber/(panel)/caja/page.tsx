export const dynamic = "force-dynamic";

import "@/components/barber/cash/money.css";
import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { getCashState, getCheckoutContext } from "@/lib/barber/cash";
import { BarberDenied } from "@/components/barber/cash/denied";
import { CajaClient } from "@/components/barber/cash/caja-client";

/**
 * /barber/caja — turno, tickets y corte. Gate en SERVIDOR: feature `cash`
 * del plan + permiso cash.view (cobrar/cortar exige cash.manage y lo vuelve
 * a verificar cada API). barbershopId sale del contexto, nunca de la URL.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);

  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);
  const dict = (getBarberDict(ctx.barbershop.locale).barber as Dictionary).caja as Dictionary;
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  if (plan.features.cash !== true) {
    return (
      <BarberDenied
        kind="plan"
        title={t("barber.caja.common.planLockedTitle")}
        body={t("barber.caja.common.planLockedBody")}
        ctaLabel={t("barber.caja.common.goToPlan")}
      />
    );
  }
  if (!hasBarberPermission(permUser, "cash.view")) {
    return (
      <BarberDenied
        kind="permission"
        title={t("barber.caja.common.noPermissionTitle")}
        body={t("barber.caja.common.noPermissionBody")}
      />
    );
  }

  const [state, checkout] = await Promise.all([
    getCashState(ctx),
    getCheckoutContext(ctx, plan.features),
  ]);

  return (
    <CajaClient
      dict={dict}
      state={state}
      checkout={checkout}
      canManage={hasBarberPermission(permUser, "cash.manage")}
    />
  );
}
