export const dynamic = "force-dynamic";

import "@/components/barber/cash/money.css";
import { notFound, redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { getSaleDetail } from "@/lib/barber/cash";
import { BarberDenied } from "@/components/barber/cash/denied";
import { TicketPrint } from "@/components/barber/cash/ticket-print";

/** /barber/caja/ticket/[saleId] — ticket imprimible. Solo tickets de la
 *  barbería en sesión (uno ajeno → 404, sin filtrar existencia). */
export default async function Page({ params }: { params: { saleId: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);
  const dict = (getBarberDict(ctx.barbershop.locale).barber as Dictionary).caja as Dictionary;
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  if (plan.features.cash !== true) {
    return <BarberDenied kind="plan" title={t("barber.caja.common.planLockedTitle")} body={t("barber.caja.common.planLockedBody")} ctaLabel={t("barber.caja.common.goToPlan")} />;
  }
  if (!hasBarberPermission(permUser, "cash.view")) {
    return <BarberDenied kind="permission" title={t("barber.caja.common.noPermissionTitle")} body={t("barber.caja.common.noPermissionBody")} />;
  }

  const sale = await getSaleDetail(ctx, params.saleId);
  if (!sale) notFound();

  return <TicketPrint sale={sale} dict={dict} />;
}
