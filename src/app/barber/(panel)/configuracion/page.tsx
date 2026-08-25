export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { getBarberSettings } from "@/lib/barber/settings";
import { BarberDenied } from "@/components/barber/cash/denied";
import { ConfiguracionScreen } from "@/components/barber/configuracion/configuracion-screen";

/**
 * /barber/configuracion — datos de la barbería, dirección pública,
 * fidelidad, inactividad, campañas y política de reserva.
 *
 * El guard de pantalla es cortesía; el candado real es del servidor: cada
 * endpoint de /api/barber/settings exige settings.edit y escribe SOLO en el
 * barbershopId de la sesión.
 *
 * i18n (convención B): sub-árbol `barber.ajustes` ya recortado, llaves
 * cortas en los componentes.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = ((getBarberDict(locale).barber as Dictionary).ajustes ?? {}) as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "settings.edit")) {
    return (
      <BarberDenied
        kind="permission"
        title={t("barber.ajustes.common.noPermissionTitle")}
        body={t("barber.ajustes.common.noPermissionBody")}
      />
    );
  }

  const [settings, plan] = await Promise.all([
    getBarberSettings(ctx),
    getBarberPlan(ctx.barbershop.plan),
  ]);

  return (
    <ConfiguracionScreen
      dict={dict}
      initial={settings}
      publicBookingInPlan={plan.features.publicBooking === true}
    />
  );
}
