export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRealtyContext, hasRealtyPermission } from "@/lib/realty-auth";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import {
  getRealtyPropertyFacets,
  listRealtyProperties,
  REALTY_DEFAULT_PAGE_SIZE,
  REALTY_PROPERTY_SORTS,
  type RealtyPropertyFilters,
  type RealtyPropertySort,
} from "@/lib/realty/properties";
import { PropertiesScreen } from "@/components/realty/properties/properties-screen";
import { RealtyDenied, realtyOrigin } from "@/components/realty/properties/denied";

/**
 * /inmobiliaria/inmuebles — la cartera.
 *
 * El servidor resuelve TODO lo que decide qué se ve: la sesión (y con ella
 * el accountId), el modo de la cuenta, la feature del plan y el permiso del
 * rol. El componente cliente solo pinta y pide más páginas — no puede
 * ampliar su propio alcance.
 *
 * Esconder el item del menú NO es control de acceso: quien escriba la URL a
 * mano llegaría igual. Por eso los tres cortes se repiten AQUÍ.
 */
const AREA = "inmuebles";

export default async function Page({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
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
  if (!hasRealtyPermission(permUser, "properties.view")) {
    return <RealtyDenied dict={dict} kind="permission" />;
  }

  // Un enlace compartido puede traer filtros en la URL. Se sanean aquí: lo
  // que llega del navegador nunca entra crudo a la consulta.
  const sp = (key: string): string | null => {
    const v = searchParams[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const rawSort = sp("sort");
  const filters: RealtyPropertyFilters = {
    q: sp("q") ?? "",
    sort: (REALTY_PROPERTY_SORTS as readonly string[]).includes(rawSort ?? "")
      ? (rawSort as RealtyPropertySort)
      : "recientes",
    page: 1,
    pageSize: REALTY_DEFAULT_PAGE_SIZE,
  };

  const [initial, facets] = await Promise.all([
    listRealtyProperties(ctx, filters),
    getRealtyPropertyFacets(ctx),
  ]);

  return (
    <PropertiesScreen
      dict={dict}
      locale={ctx.account.locale}
      initial={initial}
      facets={facets}
      mode={ctx.mode}
      canEdit={hasRealtyPermission(permUser, "properties.edit")}
      accountSlug={ctx.account.slug}
      origin={realtyOrigin(headers())}
    />
  );
}
