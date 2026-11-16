export const dynamic = "force-dynamic";

import "@/components/barber/cash/money.css";
import { notFound, redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { getSaleDetail } from "@/lib/barber/cash";
import { BarberDenied } from "@/components/barber/cash/denied";
import { TicketPrint } from "@/components/barber/cash/ticket-print";
import { prisma } from "@/lib/prisma";
import { ticketStarsCardPath } from "@/lib/barber/stars-core";

/** /barber/caja/ticket/[saleId] — ticket imprimible. Solo tickets de la
 *  barbería en sesión (uno ajeno → 404, sin filtrar existencia). */
export default async function Page(props: { params: Promise<{ saleId: string }> }) {
  const params = await props.params;
  const ctx = await getBarberContext();
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);
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

  // ws6-t1 (16-nov): el QR de la tarjeta de estrellas del cliente del ticket.
  // Sin cliente, con la tarjeta apagada o con el ticket cancelado no sale. Si
  // fallara la consulta, el ticket se imprime igual (sin QR).
  const starsCardPath = sale.cancelled
    ? null
    : await ticketStarsCardPath(prisma, { barbershopId: ctx.barbershopId, slug: ctx.barbershop.slug, saleId: sale.id }).catch(() => null);

  return <TicketPrint sale={sale} dict={dict} starsCardPath={starsCardPath} />;
}
