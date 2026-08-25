export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import {
  getLeadRoutingConfig,
  getLeadsCatalogs,
  listLeads,
  sweepStaleLeadAssignments,
  REALTY_LEADS_PAGE_SIZE,
} from "@/lib/realty/leads";
import { LeadsScreen } from "@/components/realty/leads/leads-screen";

const AREA = "prospectos";

/**
 * EL EMBUDO DE PROSPECTOS.
 *
 * Guard de tres filtros, el mismo AND del contrato que arma el sidebar:
 * MODO de la cuenta + FEATURE del plan + PERMISO del rol. El sidebar ya
 * esconde la sección en modo OWNER, pero esconder un menú NO es control de
 * acceso: quien escriba la URL a mano llegaría igual.
 *
 * i18n CONVENCIÓN B: aquí se recorta el sub-árbol `realty.leads` y el
 * componente cliente NO antepone prefijo (ver src/lib/realty/i18n.ts).
 */
export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");
  if (ctx.plan.features.leads !== true) redirect("/inmobiliaria/suscripcion");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "leads.view")) redirect("/inmobiliaria/inicio");

  const canEdit = hasRealtyPermission(permUser, "leads.edit");
  const canAssign = hasRealtyPermission(permUser, "leads.assign");

  // ⭐ La barrida de reasignación por no-respuesta corre al abrir la
  // pantalla: en serverless no hay proceso vivo que la dispare, y este es
  // justo el momento en que importa que los prospectos ya estén repartidos.
  // Si truena, la pantalla se pinta igual: quedarse sin embudo por una
  // barrida fallida sería peor que la barrida que no corrió.
  let sweep: { reassigned: number } | null = null;
  try {
    const r = await sweepStaleLeadAssignments(ctx.accountId, { timeZone: ctx.account.timezone });
    sweep = { reassigned: r.reassigned };
  } catch {
    sweep = null;
  }

  const scope = {
    role: ctx.role,
    realtyUserId: ctx.realtyUserId,
    permissionsOverride: ctx.user.permissionsOverride,
  };

  const [data, catalogs, routing] = await Promise.all([
    listLeads(ctx.accountId, {}, scope, REALTY_LEADS_PAGE_SIZE),
    getLeadsCatalogs(ctx.accountId),
    getLeadRoutingConfig(ctx.accountId),
  ]);

  const dict = (getRealtyDict(ctx.account.locale).realty as Dictionary).leads as Dictionary;

  return (
    <LeadsScreen
      dict={dict}
      locale={ctx.account.locale === "en" ? "en-US" : "es-MX"}
      canEdit={canEdit}
      canAssign={canAssign}
      timeZone={ctx.account.timezone}
      initial={{
        leads: data.leads,
        total: data.total,
        truncated: data.truncated,
        catalogs,
        routing: {
          strategy: routing.strategy,
          reassignAfterMinutes: routing.reassignAfterMinutes,
          reassignEnabled: routing.reassignEnabled,
        },
        sweep,
        me: { realtyUserId: ctx.realtyUserId, role: ctx.role },
      }}
    />
  );
}
