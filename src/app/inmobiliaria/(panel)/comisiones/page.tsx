export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getRealtyContext, hasRealtyPermission } from "@/lib/realty-auth";
import { REALTY_NAV_ITEMS, navItemAllowsMode } from "@/lib/realty/types";
import { getDealsScreen } from "@/app/api/realty/deals/service";
import { ComisionesClient } from "@/components/realty/team/comisiones-client";
import { RealtyDenied } from "@/components/realty/team/denied";

// /inmobiliaria/comisiones — operaciones cerradas, reparto, recibo del
// periodo y tablero de avance.
//
// CUATRO guardas: sesión, MODO de la cuenta (un rentista no comercializa
// para nadie), FEATURE del plan (commissions) y PERMISO commissions.view.
// El recorte de ALCANCE —un asesor ve solo lo suyo— lo hace la consulta,
// no la pantalla.

const AREA = "comisiones";

export default async function Page({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const ctx = await getRealtyContext();
  if (!ctx) redirect("/login");

  const item = REALTY_NAV_ITEMS.find((i) => i.key === AREA);
  if (item && !navItemAllowsMode(item, ctx.mode)) redirect("/inmobiliaria/inicio");

  if (ctx.plan.features.commissions !== true) {
    return (
      <RealtyDenied
        title="Las comisiones vienen con otro plan"
        body={`Tu plan ${ctx.plan.name} no incluye el reparto de comisiones. Con un plan superior registras cada operación cerrada y repartes entre captador, colocador, oficina y franquicia.`}
        cta={{ href: "/inmobiliaria/suscripcion", label: "Ver los planes" }}
      />
    );
  }

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasRealtyPermission(permUser, "commissions.view")) {
    return (
      <RealtyDenied
        title="No tienes acceso a las comisiones"
        body="Ver el reparto de comisiones requiere ese permiso. Pídeselo a quien administra el equipo."
        cta={{ href: "/inmobiliaria/inicio", label: "Volver al inicio" }}
      />
    );
  }

  const screen = await getDealsScreen(ctx, searchParams.period ?? null);
  return <ComisionesClient initial={screen} />;
}
