export const dynamic = "force-dynamic";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getRealtyContext, hasRealtyPermission } from "@/lib/realty-auth";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import { getRealtyProperty, listOwnerOptions } from "@/lib/realty/properties";
import { getRealtyStorageUsage } from "@/lib/realty/media";
import { PropertyDetail } from "@/components/realty/properties/property-detail";
import { RealtyDenied, realtyOrigin } from "@/components/realty/properties/denied";

/**
 * /inmobiliaria/inmuebles/[id] — la ficha.
 *
 * 🔴 getRealtyProperty ya filtra por el accountId de la SESIÓN: un id de
 * otra inmobiliaria devuelve null y aquí sale un 404. No se contesta
 * "existe pero no es tuyo" — eso ya sería filtrar información.
 */
const AREA = "inmuebles";

export default async function Page({ params }: { params: { id: string } }) {
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

  const property = await getRealtyProperty(ctx, params.id);
  if (!property) notFound();

  const isOwnerMode = ctx.mode === "OWNER";
  const [owners, agents, usage] = await Promise.all([
    // En modo propietario no hay libreta de dueños que consultar.
    isOwnerMode ? Promise.resolve([]) : listOwnerOptions(ctx),
    isOwnerMode
      ? Promise.resolve([] as { id: string; firstName: string; lastName: string }[])
      : prisma.realtyUser.findMany({
          where: { accountId: ctx.accountId, active: true },
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          take: 200,
        }),
    getRealtyStorageUsage(ctx.accountId, ctx.plan.storageQuotaMb),
  ]);

  return (
    <PropertyDetail
      dict={dict}
      locale={ctx.account.locale}
      property={property}
      owners={owners}
      agents={agents.map((a) => ({
        id: a.id,
        name: `${a.firstName} ${a.lastName}`.trim(),
      }))}
      usage={usage}
      mode={ctx.mode}
      canEdit={hasRealtyPermission(permUser, "properties.edit")}
      canManageOwners={hasRealtyPermission(permUser, "owners.manage")}
      hasLogo={!!ctx.account.logoUrl}
      accountSlug={ctx.account.slug}
      origin={realtyOrigin(headers())}
    />
  );
}
