// ═══════════════════════════════════════════════════════════════════════
// /barber/fila — la fila virtual de walk-ins.
//
// DOBLE GATE, los dos en el servidor:
//   · feature `walkinQueue` del plan (Avanzado y Profesional). Un plan
//     Básico ve la pantalla de "esto viene en Avanzado", no la fila.
//   · permiso `walkin.manage` del rol.
// Los endpoints /api/barber/walkins/** repiten los dos: quien conozca la
// URL de la API tampoco pasa.
// ═══════════════════════════════════════════════════════════════════════
import { redirect } from "next/navigation";
import { getBarberContext } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { hasBarberPermission } from "@/lib/barber/permissions";
import { getBarberPlan } from "@/lib/barber/plans";
import { barberPlanHasFeature } from "@/lib/barber/plan-shared";
import { getBarberDict } from "@/i18n/dictionaries/barber";
import { WalkinPanel } from "@/components/barber/walkin/walkin-panel";
import { BarberAreaLocked } from "@/components/barber/agenda/area-locked";

export const dynamic = "force-dynamic";

export default async function BarberQueuePage() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);

  const plan = await getBarberPlan(ctx.barbershop.plan);
  if (!barberPlanHasFeature(plan, "walkinQueue")) {
    return <BarberAreaLocked reason="plan" areaKey="fila" planName={plan.name} />;
  }

  if (!hasBarberPermission(
    { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride },
    "walkin.manage",
  )) {
    return <BarberAreaLocked reason="permission" areaKey="fila" />;
  }

  return (
    <WalkinPanel
      dict={getBarberDict(ctx.barbershop.locale)}
      timezone={ctx.barbershop.timezone}
      branchId={ctx.barbershopId}
      slug={ctx.barbershop.slug}
      shopName={ctx.barbershop.name}
    />
  );
}
