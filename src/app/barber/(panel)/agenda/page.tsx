// ═══════════════════════════════════════════════════════════════════════
// /barber/agenda — la pantalla que la barbería tiene abierta todo el día.
//
// El gate REAL vive en el servidor (aquí y en cada endpoint), no en el
// sidebar: esconder un botón no es un permiso.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { shopDateISO } from "@/lib/barber/agenda";
import { AgendaClient } from "@/components/barber/agenda/agenda-client";
import { BarberAreaLocked } from "@/components/barber/agenda/area-locked";

export const dynamic = "force-dynamic";

export default async function BarberAgendaPage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const dict = getBarberDict(ctx.barbershop.locale);
  const plan = await getBarberPlan(ctx.barbershop.plan);

  if (!barberPlanHasFeature(plan, "agenda")) {
    return <BarberAreaLocked reason="plan" areaKey="agenda" planName={plan.name} />;
  }
  if (!hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "agenda.view",
  )) {
    return <BarberAreaLocked reason="permission" areaKey="agenda" />;
  }

  return (
    <AgendaClient
      dict={dict}
      locale={ctx.barbershop.locale}
      timezone={ctx.barbershop.timezone}
      branchId={ctx.barbershopId}
      initialDateISO={shopDateISO(new Date(), ctx.barbershop.timezone)}
    />
  );
}
