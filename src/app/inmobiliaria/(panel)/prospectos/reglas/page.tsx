export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext } from "@/lib/realty-auth";
import { hasRealtyPermission } from "@/lib/realty/permissions";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getRealtyDict } from "@/i18n/dictionaries/realty";
import type { Dictionary } from "@/i18n/t";
import { getAssigneeCandidates, getLeadRoutingConfig } from "@/lib/realty/leads";
import {
  inboundSecret,
  listInboundMailLog,
  realtyInboundAddress,
  REALTY_PORTAL_CATALOG,
} from "@/lib/realty/inbound-mail";
import { RoutingScreen } from "@/components/realty/leads/routing-screen";

const AREA = "prospectos";

/**
 * REGLAS DE ASIGNACIÓN + BUZÓN DE CORREO de los portales.
 *
 * Sub-ruta de prospectos (no de Configuración) a propósito: quien la busca
 * está mirando el embudo, y el sidebar del contrato no se toca para agregar
 * una entrada que solo usa quien reparte.
 */
export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");
  if (ctx.plan.features.leads !== true) redirect("/inmobiliaria/suscripcion");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "leads.view")) redirect("/inmobiliaria/inicio");

  const canEdit = hasRealtyPermission(permUser, "leads.assign");

  const config = await getLeadRoutingConfig(ctx.accountId);
  const [candidates, log] = await Promise.all([
    // poolUserIds vacío a propósito: la pantalla enseña a TODOS los que
    // podrían recibir prospectos, con la palomita puesta en los que están
    // en el pool. Con el pool aplicado, quitar a alguien lo haría
    // desaparecer de la lista y ya no se podría volver a meter.
    getAssigneeCandidates(ctx.accountId, { ...config, poolUserIds: [] }),
    // Solo quien reparte ve la bitácora de correos: los asuntos de los
    // portales traen el nombre del prospecto (ver la ruta /leads/routing).
    canEdit ? listInboundMailLog(ctx.accountId, 15) : Promise.resolve([]),
  ]);

  const dict = (getRealtyDict(ctx.account.locale).realty as Dictionary).leads as Dictionary;

  return (
    <RoutingScreen
      dict={dict}
      locale={ctx.account.locale === "en" ? "en-US" : "es-MX"}
      timeZone={ctx.account.timezone}
      initial={{
        config,
        canEdit,
        candidates: candidates.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          zones: c.zones,
          openLeads: c.openLeads,
          lastAssignedAt: c.lastAssignedAt ? c.lastAssignedAt.toISOString() : null,
        })),
        inbox: {
          address: realtyInboundAddress(ctx.accountId),
          portals: REALTY_PORTAL_CATALOG.map((p) => ({ ...p })),
          configured: Boolean(inboundSecret()),
          log,
        },
        mode: ctx.mode,
      }}
    />
  );
}
