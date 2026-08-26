export const dynamic = "force-dynamic";

import "@/components/barber/cash/money.css";
import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { currentPeriodKey, DEFAULT_BARBER_TZ, isValidPeriodKey } from "@/lib/barber/commissions";
import { getInventoryStats, listProducts } from "@/lib/barber/inventory";
import { BarberDenied } from "@/components/barber/cash/denied";
import { ProductosClient } from "@/components/barber/products/productos-client";

/**
 * /barber/productos?period=YYYY-MM — catálogo e inventario. Gate en
 * SERVIDOR: feature `products` (AVANZADO+) + products.manage. Los
 * movimientos manuales exigen además inventory.manage (lo verifica la API).
 */
export default async function Page({ searchParams }: { searchParams: { period?: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);
  const plan = await getBarberPlan(ctx.barbershop.plan);
  const t = getBarberT(ctx.barbershop.locale);
  const dict = (getBarberDict(ctx.barbershop.locale).barber as Dictionary).caja as Dictionary;
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };

  if (plan.features.products !== true) {
    return <BarberDenied kind="plan" title={t("barber.caja.common.planLockedTitle")} body={t("barber.caja.common.planLockedBody")} ctaLabel={t("barber.caja.common.goToPlan")} />;
  }
  if (!hasBarberPermission(permUser, "products.manage")) {
    return <BarberDenied kind="permission" title={t("barber.caja.common.noPermissionTitle")} body={t("barber.caja.common.noPermissionBody")} />;
  }

  const tz = ctx.barbershop.timezone || DEFAULT_BARBER_TZ;
  const current = currentPeriodKey(tz);
  const period = isValidPeriodKey(searchParams.period) ? searchParams.period : current;
  const [products, stats] = await Promise.all([
    listProducts(ctx, { includeInactive: true }),
    getInventoryStats(ctx, period),
  ]);

  return (
    <ProductosClient
      dict={dict}
      locale={ctx.barbershop.locale}
      products={products}
      stats={stats}
      maxPeriod={current}
      canInventory={hasBarberPermission(permUser, "inventory.manage")}
    />
  );
}
