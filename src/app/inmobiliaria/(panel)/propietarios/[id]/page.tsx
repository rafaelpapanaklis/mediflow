export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { getRealtyContext, hasRealtyPermission } from "@/lib/realty-auth";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import { getRealtyOwner } from "@/lib/realty/properties";
import { OwnerDetailScreen } from "@/components/realty/properties/owners-screen";
import { RealtyDenied } from "@/components/realty/properties/denied";

/** /inmobiliaria/propietarios/[id] — sus datos, sus inmuebles y sus exclusivas. */
const AREA = "propietarios";

export default async function Page({ params }: { params: { id: string } }) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const dict = ((getRealtyDict(ctx.account.locale).realty as Dictionary).inmuebles ??
    {}) as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "owners.manage")) {
    return <RealtyDenied dict={dict} kind="permission" />;
  }

  // Filtrado por el accountId de la sesión: un id ajeno es un 404.
  const owner = await getRealtyOwner(ctx, params.id);
  if (!owner) notFound();

  return (
    <OwnerDetailScreen dict={dict} locale={ctx.account.locale} owner={owner} canEdit />
  );
}
