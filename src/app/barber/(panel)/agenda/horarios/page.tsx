// ═══════════════════════════════════════════════════════════════════════
// /barber/agenda/horarios — horario recurrente por barbero y bloqueos.
//
// Ver la pantalla exige agenda.view; EDITAR exige schedule.manage. El gate
// de escritura vive además en cada endpoint: aquí solo se decide si los
// campos van deshabilitados.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { ScheduleManager } from "@/components/barber/agenda/schedule-manager";
import { BarberAreaLocked } from "@/components/barber/agenda/area-locked";

export const dynamic = "force-dynamic";

export default async function BarberSchedulePage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (!barberPlanHasFeature(plan, "agenda")) {
    return <BarberAreaLocked reason="plan" areaKey="agenda" planName={plan.name} />;
  }

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "agenda.view")) {
    return <BarberAreaLocked reason="permission" areaKey="agenda" />;
  }

  return (
    <ScheduleManager
      dict={getBarberDict(ctx.barbershop.locale)}
      timezone={ctx.barbershop.timezone}
      branchId={ctx.barbershopId}
      canManage={hasBarberPermission(permUser, "schedule.manage")}
    />
  );
}
