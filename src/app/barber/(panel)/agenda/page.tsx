// ═══════════════════════════════════════════════════════════════════════
// /barber/agenda — la pantalla que la barbería tiene abierta todo el día.
//
// El gate REAL vive en el servidor (aquí y en cada endpoint), no en el
// sidebar: esconder un botón no es un permiso.
//
// Trae también lo que hace falta para COBRAR desde aquí: el sub-diccionario
// de la caja y si el plan la incluye. El cobro en sí no se reimplementa —
// se monta el mismo modal de ticket de /barber/caja (ver charge-bridge), y
// por eso hay que cargar su hoja de estilos, igual que hace esa pantalla.
// ═══════════════════════════════════════════════════════════════════════
import "@/components/barber/cash/money.css";
import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { shopDateISO } from "@/lib/barber/agenda";
import { AgendaClient } from "@/components/barber/agenda/agenda-client";
import { BarberAreaLocked } from "@/components/barber/agenda/area-locked";

export const dynamic = "force-dynamic";

export default async function BarberAgendaPage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);

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
      cajaDict={(dict.barber as Dictionary).caja as Dictionary}
      locale={ctx.barbershop.locale}
      timezone={ctx.barbershop.timezone}
      branchId={ctx.barbershopId}
      initialDateISO={shopDateISO(new Date(), ctx.barbershop.timezone)}
      cashEnabled={barberPlanHasFeature(plan, "cash")}
    />
  );
}
