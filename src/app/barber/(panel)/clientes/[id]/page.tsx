import { notFound, redirect } from "next/navigation";
import { getBarberContext, hasBarberPermission } from "@/lib/barber-auth";
import { getBarberPlan } from "@/lib/barber/plans";
import { getBarberDict, getBarberT, resolveBarberLocale } from "@/i18n/dictionaries/barber";
import type { Dictionary } from "@/i18n/t";
import { getBarberClientDetail } from "@/lib/barber/loyalty";
import { BarberClientDetailScreen } from "@/components/barber/clients/client-detail";

export const dynamic = "force-dynamic";

/**
 * /barber/clientes/[id] — la ficha.
 *
 * getBarberClientDetail filtra por el barbershopId de la SESIÓN, así que un
 * id de otra barbería no devuelve nada y esto cae en notFound(). Desde
 * fuera, "ajeno" y "no existe" se ven exactamente igual: la URL no revela
 * ni siquiera que la ficha exista.
 */
export default async function Page({ params }: { params: { id: string } }) {
  const ctx = await getBarberContext();
  if (!ctx) redirect("/login");

  const locale = resolveBarberLocale(ctx.barbershop.locale);
  const t = getBarberT(locale);
  const dict = ((getBarberDict(locale).barber as Dictionary).clientes ?? {}) as Dictionary;

  const permUser = { role: ctx.role, permissionsOverride: ctx.user.permissionsOverride };
  const plan = await getBarberPlan(ctx.barbershop.plan);

  if (plan.features.clients !== true || !hasBarberPermission(permUser, "clients.view")) {
    return (
      <div
        style={{
          maxWidth: 520,
          margin: "12vh auto 0",
          padding: "clamp(20px, 4vw, 32px)",
          borderRadius: 16,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-soft)",
          textAlign: "center",
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text-2)",
        }}
      >
        {t("barber.clientes.errors.noPermission")}
      </div>
    );
  }

  const detail = await getBarberClientDetail(ctx, params.id);
  if (!detail) notFound();

  return (
    <BarberClientDetailScreen
      dict={dict}
      locale={locale}
      detail={detail}
      canEdit={hasBarberPermission(permUser, "clients.edit")}
      canPublish={hasBarberPermission(permUser, "portal.manage")}
    />
  );
}
