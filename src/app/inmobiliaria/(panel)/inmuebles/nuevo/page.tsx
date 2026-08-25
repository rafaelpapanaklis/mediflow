export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext, hasRealtyPermission } from "@/lib/realty-auth";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import { NewPropertyForm } from "@/components/realty/properties/property-detail";
import { RealtyDenied } from "@/components/realty/properties/denied";

/**
 * /inmobiliaria/inmuebles/nuevo — el alta.
 *
 * Pide lo MÍNIMO (título y tipo) y manda a la ficha. Un formulario de
 * cuarenta campos antes de poder guardar nada es lo que hace que la cartera
 * se quede a medio capturar: aquí se crea primero y se completa después,
 * sección por sección.
 */
const AREA = "inmuebles";

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const dict = ((getRealtyDict(ctx.account.locale).realty as Dictionary).inmuebles ??
    {}) as Dictionary;

  if (ctx.plan.features.properties !== true) {
    return <RealtyDenied dict={dict} kind="plan" />;
  }
  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "properties.edit")) {
    return <RealtyDenied dict={dict} kind="permission" />;
  }

  return <NewPropertyForm dict={dict} canEdit />;
}
