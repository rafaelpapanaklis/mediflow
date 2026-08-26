export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { requireBarberPaidAccess } from "@/lib/barber/paid-access";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import {
  SERVICE_CATEGORY_SUGGESTIONS,
  defaultServicesPreview,
  listServices,
} from "@/lib/barber/services";
import { BarberDenied } from "@/components/barber/cash/denied";
import { ServiciosScreen } from "@/components/barber/servicios/servicios-screen";

/**
 * /barber/servicios — el catálogo que alimenta la agenda, la reserva
 * pública, la mini-web, el bot y el ticket.
 *
 * El guard de pantalla es cortesía; el candado real es del servidor: cada
 * endpoint de /api/barber/services llama assertBarberPermission
 * (services.manage) y filtra por el barbershopId de la sesión.
 *
 * i18n (convención B del vertical): se baja el sub-árbol `barber.ajustes`
 * ya recortado y los componentes usan llaves cortas — nadie antepone
 * prefijo, así no puede aplicarse dos veces.
 */
export default async function Page() {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");
  await requireBarberPaidAccess(ctx);

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = ((getBarberDict(locale).barber as Dictionary).ajustes ?? {}) as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  if (!hasBarberPermission(permUser, "services.manage")) {
    return (
      <BarberDenied
        kind="permission"
        title={t("barber.ajustes.common.noPermissionTitle")}
        body={t("barber.ajustes.common.noPermissionBody")}
      />
    );
  }

  const catalog = await listServices(ctx);

  return (
    <ServiciosScreen
      dict={dict}
      initial={catalog}
      seedPreview={defaultServicesPreview()}
      categorySuggestions={SERVICE_CATEGORY_SUGGESTIONS}
    />
  );
}
