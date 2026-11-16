export const dynamic = "force-dynamic";

import "@/components/barber/cash/money.css";
import { notFound, redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { getCashSessionSummary } from "@/lib/barber/cash";
import { BarberCajaError, DEFAULT_BARBER_TZ } from "@/lib/barber/commissions";
import { BarberDenied } from "@/components/barber/cash/denied";
import { CortePrint } from "@/components/barber/cash/corte-print";

/** /barber/caja/corte/[sessionId] — corte imprimible (y reimprimir). Solo
 *  cortes de la sede en sesión (otro → 404, sin filtrar existencia). cash.view. */
export default async function Page(props: { params: Promise<{ sessionId: string }> }) {
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

  let summary;
  try {
    summary = await getCashSessionSummary(ctx, params.sessionId);
  } catch (e) {
    if (e instanceof BarberCajaError && e.status === 404) notFound();
    throw e;
  }
  const shop = ctx.barbershop;
  return (
    <CortePrint
      dict={dict}
      summary={summary}
      shop={{ name: shop.name, logoUrl: shop.logoUrl, timezone: shop.timezone || DEFAULT_BARBER_TZ }}
    />
  );
}
