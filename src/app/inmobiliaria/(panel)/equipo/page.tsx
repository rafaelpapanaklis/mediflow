export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext, hasRealtyPermission } from "@/lib/realty-auth";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getTeamContext } from "@/lib/realty/team";
import { getOfficesForTeamScreen } from "@/lib/realty/offices";
import { EquipoClient } from "@/components/realty/team/equipo-client";
import { RealtyDenied } from "@/components/realty/team/denied";

// /inmobiliaria/equipo — usuarios, roles, permisos, ficha pública y oficinas.
//
// TRES guardas, y ninguna sustituye a las otras:
//   1. Sesión: sin contexto, al login compartido.
//   2. MODO de la cuenta: esta sección es solo de AGENCY (un asesor
//      independiente y un rentista no tienen equipo). Sale del MISMO campo
//      `modes` del contrato, no de un if inventado aquí.
//   3. PERMISO team.manage.
//
// Y aun así, el candado de verdad está en cada endpoint de
// /api/realty/team/**: esconder una pantalla NUNCA es control de acceso.

const AREA = "equipo";

export default async function Page() {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "team.manage")) {
    return (
      <RealtyDenied
        title="Esta sección no es para tu rol"
        body="Administrar el equipo, los permisos y las oficinas le toca a quien tiene ese permiso en tu inmobiliaria. Pídeselo a quien lleva la cuenta."
        cta={{ href: "/inmobiliaria/inicio", label: "Volver al inicio" }}
      />
    );
  }

  const [team, offices] = await Promise.all([getTeamContext(ctx), getOfficesForTeamScreen(ctx)]);

  return (
    <EquipoClient
      initialTeam={team}
      offices={offices}
      planName={ctx.plan.name}
      canManageOffices={hasRealtyPermission(permUser, "offices.manage")}
    />
  );
}
