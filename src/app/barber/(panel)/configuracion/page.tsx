export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { getBarberSettings } from "@/lib/barber/settings";
import { ConfiguracionScreen } from "@/components/barber/configuracion/configuracion-screen";
import { MiCuentaScreen } from "@/components/barber/configuracion/mi-contrasena-card";

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
  if (!ctx) redirect("/barber/entrar");
  await requireBarberPaidAccess(ctx);

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const dict = ((getBarberDict(locale).barber as Dictionary).ajustes ?? {}) as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "settings.edit")) {
    // Sin permiso para la barbería, pero SÍ para lo suyo: cambiar su propia
    // contraseña (auditoría 14-nov, M5). Antes aquí solo había «sin acceso».
    return <MiCuentaScreen dict={dict} />;
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
