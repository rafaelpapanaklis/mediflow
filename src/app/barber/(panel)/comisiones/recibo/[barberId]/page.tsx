export const dynamic = "force-dynamic";

import "@/components/barber/cash/money.css";
import { notFound, redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import {
  BarberCajaError,
  COMMISSION_BASE_LABELS,
  currentPeriodKey,
  DEFAULT_BARBER_TZ,
  getCommissionReceipt,
  isValidPeriodKey,
} from "@/lib/barber/commissions";
import { BarberDenied } from "@/components/barber/cash/denied";
import { ReceiptPrint } from "@/components/barber/commissions/receipt-print";

/** /barber/comisiones/recibo/[barberId]?period=YYYY-MM — recibo imprimible.
 *  Un BARBER que pida el recibo de otro recibe 404 (el recorte es del server). */
export default async function Page({
  params,
  searchParams,
}: {
  params: { barberId: string };
  searchParams: { period?: string };
}) {
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
  const periodKey = isValidPeriodKey(searchParams.period) ? searchParams.period : currentPeriodKey(tz);

  let receipt: Awaited<ReturnType<typeof getCommissionReceipt>>;
  try {
    receipt = await getCommissionReceipt(ctx, { barberId: params.barberId, periodKey });
  } catch (e) {
    if (e instanceof BarberCajaError && e.status === 403) notFound();
    throw e;
  }
  if (!receipt) notFound();

  return (
    <ReceiptPrint
      dict={dict}
      locale={ctx.barbershop.locale}
      shopName={ctx.barbershop.name}
      periodKey={periodKey}
      tz={tz}
      row={receipt.row}
      entries={receipt.entries}
      policyLabel={COMMISSION_BASE_LABELS[receipt.summary.policy.base]}
    />
  );
}
