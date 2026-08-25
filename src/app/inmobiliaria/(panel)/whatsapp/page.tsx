export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { realtyPlanHasFeature } from "@/lib/realty/plan-shared";
import { getRealtyPlans } from "@/lib/realty/plans";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import { RealtyWaPanel } from "@/components/realty/whatsapp/realty-wa-panel";
import { RealtyWaUpsell } from "@/components/realty/whatsapp/realty-wa-upsell";

const AREA = "whatsapp";

/**
 * WhatsApp del vertical INMUEBLES.
 *
 * Tres recortes, y ninguno es el sidebar: esconder un menú NO es control de
 * acceso, quien escriba la URL a mano llegaría igual.
 *   1. MODO de la cuenta — sale del contrato, no de un if inventado aquí.
 *   2. PERMISO whatsapp.view del rol.
 *   3. FEATURE `whatsapp` del plan. Y aquí NO se redirige: se enseña la
 *      pantalla de qué hay del otro lado, con los precios leídos de la
 *      tabla. Mandar a alguien a /inicio sin explicarle nada es peor.
 *
 * i18n — CONVENCIÓN B: el servidor recorta el sub-árbol `realty.whatsapp` y
 * los componentes usan makeRealtyT(dict) SIN prefijo. Cruzar las dos
 * convenciones aplicaría el prefijo dos veces y pintaría la llave cruda.
 */
export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  if (!hasRealtyPermission({ role: ctx.role, permissionsOverride: ctx.user.permissionsOverride }, "whatsapp.view")) {
    redirect("/inmobiliaria/inicio");
  }

  const dict = ((getRealtyDict(ctx.account.locale).realty as Dictionary).whatsapp ?? {}) as Dictionary;

  if (!realtyPlanHasFeature(ctx.plan, "whatsapp")) {
    const plans = await getRealtyPlans();
    return <RealtyWaUpsell dict={dict} plans={plans} currentPlanName={ctx.plan.name} />;
  }

  const canSend = hasRealtyPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "whatsapp.send",
  );

  return <RealtyWaPanel dict={dict} canSend={canSend} accountName={ctx.account.name} />;
}
