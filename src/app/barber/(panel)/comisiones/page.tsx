export const dynamic = "force-dynamic";

import "@/components/barber/cash/money.css";
import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { currentPeriodKey, DEFAULT_BARBER_TZ, getCommissionSummary, isValidPeriodKey } from "@/lib/barber/commissions";
import { BarberDenied } from "@/components/barber/cash/denied";
import { ComisionesClient } from "@/components/barber/commissions/comisiones-client";

/**
 * /barber/comisiones?period=YYYY-MM — nómina por barbero. Gate en SERVIDOR:
 * feature `commissions` (AVANZADO+) + commissions.view. Un rol BARBER recibe
 * SOLO su fila (el recorte lo hace getCommissionSummary, no la UI).
 */
export default async function Page({ searchParams }: { searchParams: { period?: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);
  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);
  const dict = (getBarberDict(ctx.barbershop.locale).barber as Dictionary).caja as Dictionary;
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  if (plan.features.commissions !== true) {
    return <BarberDenied kind="plan" title={t("barber.caja.common.planLockedTitle")} body={t("barber.caja.common.planLockedBody")} ctaLabel={t("barber.caja.common.goToPlan")} />;
  }
  if (!hasBarberPermission(permUser, "commissions.view")) {
    return <BarberDenied kind="permission" title={t("barber.caja.common.noPermissionTitle")} body={t("barber.caja.common.noPermissionBody")} />;
  }

  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
  const current = currentPeriodKey(tz);
  const period = isValidPeriodKey(searchParams.period) ? searchParams.period : current;
  const summary = await getCommissionSummary(ctx, period);

  return (
    <ComisionesClient
      dict={dict}
      locale={ctx.barbershop.locale}
      summary={summary}
      maxPeriod={current}
      canManage={hasBarberPermission(permUser, "commissions.manage")}
      noBarberLinked={ctx.role === "BARBER" && !ctx.barber}
    />
  );
}
